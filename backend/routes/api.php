<?php

use App\Http\Controllers\Api\Admin\CategoryAdminController;
use App\Http\Controllers\Api\Admin\DashboardController;
use App\Http\Controllers\Api\Admin\OrderAdminController;
use App\Http\Controllers\Api\Admin\ProductAdminController;
use App\Http\Controllers\Api\Admin\SiteSettingsAdminController;
use App\Http\Controllers\Api\Admin\UserAdminController;
use App\Http\Controllers\Api\Admin\VoucherAdminController;
use App\Http\Controllers\Api\AddressController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CartController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\ShippingController;
use App\Http\Controllers\Api\SiteSettingsController;
use App\Http\Controllers\Api\VoucherController;
use Illuminate\Support\Facades\Route;

// ----------------- Public -----------------
Route::get('/health', fn () => response()->json(['ok' => true, 'app' => config('app.name')]));

Route::get('/categories',          [CategoryController::class, 'index']);
Route::get('/products',            [ProductController::class, 'index']);
Route::get('/products/suggest',    [ProductController::class, 'suggest']);
Route::get('/products/{slug}',     [ProductController::class, 'show']);
Route::post('/vouchers/check',     [VoucherController::class, 'check']);
Route::get('/shipping/provinces',  [ShippingController::class, 'provinces']);
Route::get('/shipping/cities',     [ShippingController::class, 'cities']);
Route::post('/shipping/cost',      [ShippingController::class, 'cost']);
Route::post('/shipping/biteship/rates', [ShippingController::class, 'biteshipRates']);

// Public site settings (logo, hero, footer, WA widget) — dipakai storefront.
Route::get('/site-settings',       [SiteSettingsController::class, 'show']);

// ----------------- Auth (public) -----------------
Route::post('/auth/register',      [AuthController::class, 'register']);
Route::post('/auth/login',         [AuthController::class, 'login']);
Route::post('/auth/admin/login',   [AuthController::class, 'adminLogin']);
Route::post('/auth/otp/request',   [AuthController::class, 'requestOtp']);
Route::post('/auth/otp/verify',    [AuthController::class, 'verifyOtp']);
Route::get('/auth/google/redirect',[AuthController::class, 'googleRedirect']);
Route::get('/auth/google/callback',[AuthController::class, 'googleCallback']);

// ----------------- Webhooks -----------------
Route::post('/payments/midtrans/notification', [PaymentController::class, 'midtransNotification']);
Route::post('/webhooks/biteship', [\App\Http\Controllers\Api\BiteshipWebhookController::class, 'handle']);

// ----------------- Authenticated (both roles) -----------------
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/auth/me',    [AuthController::class, 'me']);
    Route::patch('/auth/profile', [AuthController::class, 'updateProfile']);
    Route::post('/auth/logout',[AuthController::class, 'logout']);

    // Customer-only
    Route::middleware('customer')->group(function () {
        Route::get('/cart',              [CartController::class, 'show']);
        Route::post('/cart/items',       [CartController::class, 'add']);
        Route::patch('/cart/items/{item}', [CartController::class, 'updateItem']);
        Route::delete('/cart/items/{item}', [CartController::class, 'removeItem']);
        Route::delete('/cart',           [CartController::class, 'clear']);

        Route::get('/addresses',         [AddressController::class, 'index']);
        Route::post('/addresses',        [AddressController::class, 'store']);
        Route::patch('/addresses/{address}', [AddressController::class, 'update']);
        Route::delete('/addresses/{address}', [AddressController::class, 'destroy']);

        Route::get('/orders',            [OrderController::class, 'index']);
        Route::get('/orders/{orderNumber}', [OrderController::class, 'show']);
        Route::post('/orders/checkout',  [OrderController::class, 'checkout']);
        Route::post('/orders/{orderNumber}/cancel', [OrderController::class, 'cancel']);
        Route::post('/orders/{orderNumber}/repay',  [OrderController::class, 'repay']);
        Route::post('/orders/{orderNumber}/sync-status', [OrderController::class, 'syncStatus']);
        // Upload bukti transfer untuk pembayaran manual
        Route::post('/orders/{orderNumber}/payment-proof', [OrderController::class, 'uploadPaymentProof']);
    });

    // Admin-only
    Route::middleware('admin')->prefix('admin')->group(function () {
        Route::get('/dashboard',             [DashboardController::class, 'summary']);
        Route::get('/reports/sales',         [DashboardController::class, 'salesReport']);

        Route::apiResource('categories',     CategoryAdminController::class)->except(['show']);
        Route::post('/products/upload-image', [ProductAdminController::class, 'uploadImage']);
        Route::post('/products/bulk-operational-cost', [ProductAdminController::class, 'bulkOperationalCost']);
        // Bulk import (JSON array, di-parse di frontend dari Excel/CSV) & export.
        Route::post('/products/bulk-import',  [ProductAdminController::class, 'bulkImport']);
        Route::get('/products/export',        [ProductAdminController::class, 'bulkExport']);
        Route::apiResource('products',       ProductAdminController::class);
        Route::apiResource('vouchers',       VoucherAdminController::class)->except(['show']);

        Route::get('/orders',                [OrderAdminController::class, 'index']);
        Route::get('/orders/{order}',        [OrderAdminController::class, 'show']);
        Route::patch('/orders/{order}/status', [OrderAdminController::class, 'updateStatus']);
        Route::post('/orders/{order}/tracking', [OrderAdminController::class, 'addTrackingEvent']);
        // Verifikasi pembayaran transfer manual
        Route::post('/orders/{order}/approve-payment', [OrderAdminController::class, 'approvePayment']);
        Route::post('/orders/{order}/reject-payment',  [OrderAdminController::class, 'rejectPayment']);
        // Biteship integration — admin only
        Route::post('/orders/{order}/biteship/create',  [OrderAdminController::class, 'biteshipCreate']);
        Route::post('/orders/{order}/biteship/refresh', [OrderAdminController::class, 'biteshipRefresh']);
        Route::post('/orders/{order}/biteship/cancel',  [OrderAdminController::class, 'biteshipCancel']);

        Route::get('/users',                 [UserAdminController::class, 'index']);
        Route::post('/users',                [UserAdminController::class, 'store']);
        Route::get('/users/{user}',          [UserAdminController::class, 'show']);
        Route::patch('/users/{user}',        [UserAdminController::class, 'update']);
        Route::delete('/users/{user}',       [UserAdminController::class, 'destroy']);
        Route::patch('/users/{user}/toggle-suspend', [UserAdminController::class, 'toggleSuspend']);

        // Pengaturan Tampilan (logo, hero, footer, widget WhatsApp).
        Route::get('/site-settings',          [SiteSettingsAdminController::class, 'show']);
        Route::put('/site-settings',          [SiteSettingsAdminController::class, 'update']);
        Route::post('/site-settings/upload',  [SiteSettingsAdminController::class, 'uploadAsset']);
    });
});
