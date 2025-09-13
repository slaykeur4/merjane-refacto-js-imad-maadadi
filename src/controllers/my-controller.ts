/* eslint-disable @typescript-eslint/switch-exhaustiveness-check */
/* eslint-disable max-depth */
/* eslint-disable no-await-in-loop */
import {eq} from 'drizzle-orm';
import fastifyPlugin from 'fastify-plugin';
import {serializerCompiler, validatorCompiler, type ZodTypeProvider} from 'fastify-type-provider-zod';
import {z} from 'zod';
import {orders, products} from '@/db/schema.js';

// Modular availability logic
function isProductAvailable(p: typeof products.$inferSelect, now: Date): boolean {
    switch (p.type) {
        case 'NORMAL':
            return p.available > 0;

        case 'SEASONAL': {
            const restockDate = new Date(now.getTime() + p.leadTime * 86400000);
            return p.available > 0 || restockDate <= p.seasonEndDate!;
        }

        case 'EXPIRABLE':
            return p.available > 0 && now <= p.expiryDate!;
    }

    return false;
}

// Modular notification logic
function getProductNotification(p: typeof products.$inferSelect, now: Date): string | null {
    switch (p.type) {
        case 'NORMAL':
            return p.available === 0 ? `Produit en rupture, délai de ${p.leadTime} jours` : null;

        case 'SEASONAL': {
            const restockDate = new Date(now.getTime() + p.leadTime * 86400000);
            if (p.available === 0 && restockDate > p.seasonEndDate!) {
                return 'Produit saisonnier indisponible';
            }
            return p.available === 0 ? `Produit saisonnier en rupture, délai de ${p.leadTime} jours` : null;
        }

        case 'EXPIRABLE':
            return now > p.expiryDate! ? 'Produit expiré' : null;
    }

    return null;
}

export const myController = fastifyPlugin(async server => {
    server.setValidatorCompiler(validatorCompiler);
    server.setSerializerCompiler(serializerCompiler);

    server.withTypeProvider<ZodTypeProvider>().post('/orders/:orderId/processOrder', {
        schema: {
            params: z.object({
                orderId: z.coerce.number(),
            }),
        },
    }, async (request, reply) => {
        const dbse = server.diContainer.resolve('db');
        const ps = server.diContainer.resolve('ps');
        const order = (await dbse.query.orders.findFirst({
            where: eq(orders.id, request.params.orderId),
            with: {
                products: {
                    columns: {},
                    with: {
                        product: true,
                    },
                },
            },
        }))!;

        const {products: productList} = order;
        const now = new Date(); // Centralized current date

        if (productList) {
            for (const {product: p} of productList) {
                const isAvailable = isProductAvailable(p, now); // Modular availability check

                if (isAvailable) {
                    p.available -= 1;
                    await dbse.update(products).set(p).where(eq(products.id, p.id));
                } else {
                    // Use original handlers for clarity
                    switch (p.type) {
                        case 'NORMAL':
                            await ps.notifyDelay(p.leadTime, p);
                            break;

                        case 'SEASONAL':
                            await ps.handleSeasonalProduct(p);
                            break;

                        case 'EXPIRABLE':
                            await ps.handleExpiredProduct(p);
                            break;
                    }
                }
            }
        }

        await reply.send({orderId: order.id});
    });
});
