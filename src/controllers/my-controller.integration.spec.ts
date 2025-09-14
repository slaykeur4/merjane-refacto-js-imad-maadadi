import {
	describe, it, expect, beforeEach,
	afterEach,
} from 'vitest';
import {type FastifyInstance} from 'fastify';
import supertest from 'supertest';
import {eq} from 'drizzle-orm';
import {type DeepMockProxy, mockDeep} from 'vitest-mock-extended';
import {asValue} from 'awilix';
import {type INotificationService} from '@/services/notifications.port.js';
import {
	type ProductInsert,
	products,
	orders,
	ordersToProducts,
} from '@/db/schema.js';
import {type Database} from '@/db/type.js';
import {buildFastify} from '@/fastify.js';

describe('MyController Integration Tests', () => {
	let fastify: FastifyInstance;
	let database: Database;
	let notificationServiceMock: DeepMockProxy<INotificationService>;

	beforeEach(async () => {
		notificationServiceMock = mockDeep<INotificationService>();

		fastify = await buildFastify();
		fastify.diContainer.register({
			ns: asValue(notificationServiceMock as INotificationService),
		});
		await fastify.ready();
		database = fastify.database;
	});
	afterEach(async () => {
		await fastify.close();
	});

	// Updated test to make transaction synchronous
	it('ProcessOrderShouldReturn', async () => {
		const client = supertest(fastify.server);
		const allProducts = createProducts();

		// Insert products and order outside the transaction
		const productList = await database.insert(products).values(allProducts).returning({ productId: products.id });
		const [order] = await database.insert(orders).values([{}]).returning({ orderId: orders.id });

		// Link products to order inside a synchronous transaction
		database.transaction(tx => {
			tx.insert(ordersToProducts).values(
				productList.map(p => ({
					orderId: order.orderId,
					productId: p.productId,
				}))
			);
		});

		// Process the order via HTTP
		await client
			.post(`/orders/${order.orderId}/processOrder`)
			.expect(200)
			.expect('Content-Type', /application\/json/);

		// Validate the order was processed
		const resultOrder = await database.query.orders.findFirst({
			where: eq(orders.id, order.orderId),
		});
		expect(resultOrder!.id).toBe(order.orderId);
	});


	function createProducts(): ProductInsert[] {
		const d = 24 * 60 * 60 * 1000;
		return [
			{
				leadTime: 15, available: 30, type: 'NORMAL', name: 'USB Cable',
			},
			{
				leadTime: 10, available: 0, type: 'NORMAL', name: 'USB Dongle',
			},
			{
				leadTime: 15, available: 30, type: 'EXPIRABLE', name: 'Butter', expiryDate: new Date(Date.now() + (26 * d)),
			},
			{
				leadTime: 90, available: 6, type: 'EXPIRABLE', name: 'Milk', expiryDate: new Date(Date.now() - (2 * d)),
			},
			{
				leadTime: 15, available: 30, type: 'SEASONAL', name: 'Watermelon', seasonStartDate: new Date(Date.now() - (2 * d)), seasonEndDate: new Date(Date.now() + (58 * d)),
			},
			{
				leadTime: 15, available: 30, type: 'SEASONAL', name: 'Grapes', seasonStartDate: new Date(Date.now() + (180 * d)), seasonEndDate: new Date(Date.now() + (240 * d)),
			},
		];
	}
});
