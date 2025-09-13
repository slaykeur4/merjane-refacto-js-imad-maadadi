import {
	describe, it, expect, beforeEach,
	afterEach,
} from 'vitest';
import {mockDeep, type DeepMockProxy} from 'vitest-mock-extended';
import {type INotificationService} from '../notifications.port.js';
import {createDatabaseMock, cleanUp} from '../../utils/test-utils/database-tools.ts.js';
import {ProductService} from './product.service.js';
import {products, type Product} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

describe('ProductService Tests', () => {
	let notificationServiceMock: DeepMockProxy<INotificationService>;
	let productService: ProductService;
	let databaseMock: Database;
	let databaseName: string;

	beforeEach(async () => {
		({databaseMock, databaseName} = await createDatabaseMock());
		notificationServiceMock = mockDeep<INotificationService>();
		productService = new ProductService({
			ns: notificationServiceMock,
			db: databaseMock,
		});
	});

	afterEach(async () => cleanUp(databaseName));

	it('should handle delay notification correctly', async () => {
		// GIVEN
		const product: Product = {
			id: 1,
			leadTime: 15,
			available: 0,
			type: 'NORMAL',
			name: 'RJ45 Cable',
			expiryDate: null,
			seasonStartDate: null,
			seasonEndDate: null,
		};
		await databaseMock.insert(products).values(product);

		// WHEN
		await productService.notifyDelay(product.leadTime, product);

		// THEN
		expect(product.available).toBe(0);
		expect(product.leadTime).toBe(15);
		expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(product.leadTime, product.name);
		const result = await databaseMock.query.products.findFirst({
			where: (product, {eq}) => eq(product.id, product.id),
		});
		expect(result).toEqual(product);
	});

	// New tests
	it('should notify expiration and zero availability for expired product', async () => {
		const expiredProduct: Product = {
			id: 2,
			leadTime: 5,
			available: 3,
			type: 'EXPIRABLE',
			name: 'Expired Yogurt',
			expiryDate: new Date(Date.now() - 86400000),
			seasonStartDate: null,
			seasonEndDate: null,
		};
		await databaseMock.insert(products).values(expiredProduct);

		await productService.handleExpiredProduct(expiredProduct);

		expect(notificationServiceMock.sendExpirationNotification).toHaveBeenCalledWith(expiredProduct.name, expiredProduct.expiryDate);
		expect(expiredProduct.available).toBe(0);
		const result = await databaseMock.query.products.findFirst({
			where: (product, {eq}) => eq(product.id, expiredProduct.id),
		});
		expect(result?.available).toBe(0);
	});

	it('should decrement available for fresh expirable product', async () => {
		const freshProduct: Product = {
			id: 3,
			leadTime: 2,
			available: 2,
			type: 'EXPIRABLE',
			name: 'Fresh Milk',
			expiryDate: new Date(Date.now() + 86400000),
			seasonStartDate: null,
			seasonEndDate: null,
		};
		await databaseMock.insert(products).values(freshProduct);

		await productService.handleExpiredProduct(freshProduct);

		expect(notificationServiceMock.sendExpirationNotification).not.toHaveBeenCalled();
		expect(freshProduct.available).toBe(1);
		const result = await databaseMock.query.products.findFirst({
			where: (product, {eq}) => eq(product.id, freshProduct.id),
		});
		expect(result?.available).toBe(1);
	});

	it('should notify seasonal unavailability if restock exceeds seasonEndDate', async () => {
		const d = 86400000;
		const seasonalProduct: Product = {
			id: 4,
			leadTime: 10,
			available: 0,
			type: 'SEASONAL',
			name: 'Late Watermelon',
			expiryDate: null,
			seasonStartDate: new Date(Date.now() - d),
			seasonEndDate: new Date(Date.now() + (5 * d)),
		};
		await databaseMock.insert(products).values(seasonalProduct);

		await productService.handleSeasonalProduct(seasonalProduct);

		expect(notificationServiceMock.sendOutOfStockNotification).toHaveBeenCalledWith(seasonalProduct.name);
		expect(seasonalProduct.available).toBe(0);
		const result = await databaseMock.query.products.findFirst({
			where: (product, {eq}) => eq(product.id, seasonalProduct.id),
		});
		expect(result?.available).toBe(0);
	});

	it('should fallback to notifyDelay for seasonal product within season', async () => {
		const d = 86400000;
		const seasonalProduct: Product = {
			id: 5,
			leadTime: 2,
			available: 0,
			type: 'SEASONAL',
			name: 'Valid Grapes',
			expiryDate: null,
			seasonStartDate: new Date(Date.now() - d),
			seasonEndDate: new Date(Date.now() + (10 * d)),
		};
		await databaseMock.insert(products).values(seasonalProduct);

		await productService.handleSeasonalProduct(seasonalProduct);

		expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(seasonalProduct.leadTime, seasonalProduct.name);
	});

	it('should notify out of stock if season hasn’t started yet', async () => {
		const d = 86400000;
		const seasonalProduct: Product = {
			id: 6,
			leadTime: 5,
			available: 0,
			type: 'SEASONAL',
			name: 'Early Mango',
			expiryDate: null,
			seasonStartDate: new Date(Date.now() + (2 * d)),
			seasonEndDate: new Date(Date.now() + (10 * d)),
		};
		await databaseMock.insert(products).values(seasonalProduct);

		await productService.handleSeasonalProduct(seasonalProduct);

		expect(notificationServiceMock.sendOutOfStockNotification).toHaveBeenCalledWith(seasonalProduct.name);
	});

	
});

