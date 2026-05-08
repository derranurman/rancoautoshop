<?php

return [
    'name'      => env('APP_NAME', 'Ranco Autoshop'),
    'env'       => env('APP_ENV', 'production'),
    'debug'     => (bool) env('APP_DEBUG', false),
    'url'       => env('APP_URL', 'http://localhost'),
    'timezone'  => 'Asia/Jakarta',
    'locale'    => 'id',
    'fallback_locale' => 'en',
    'faker_locale'    => 'id_ID',
    'cipher'    => 'AES-256-CBC',
    'key'       => env('APP_KEY'),
    'previous_keys' => [],
    'maintenance' => [
        'driver' => 'file',
    ],
];
