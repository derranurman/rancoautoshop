<?php

return [
    'google' => [
        'client_id'     => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect'      => env('GOOGLE_REDIRECT_URI'),
    ],

    'twilio' => [
        'sid'            => env('TWILIO_ACCOUNT_SID'),
        'token'          => env('TWILIO_AUTH_TOKEN'),
        'whatsapp_from'  => env('TWILIO_WHATSAPP_FROM'),
    ],

    'midtrans' => [
        'server_key'    => env('MIDTRANS_SERVER_KEY'),
        'client_key'    => env('MIDTRANS_CLIENT_KEY'),
        'is_production' => env('MIDTRANS_IS_PRODUCTION', false),
        'snap_url'      => env('MIDTRANS_SNAP_URL'),
    ],

    'rajaongkir' => [
        'api_key'         => env('RAJAONGKIR_API_KEY'),
        'base_url'        => env('RAJAONGKIR_BASE_URL', 'https://api.rajaongkir.com/starter'),
        'origin_city_id'  => env('RAJAONGKIR_ORIGIN_CITY_ID', '152'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Komerce Collaborator API
    |--------------------------------------------------------------------------
    |
    | Komerce acquired RajaOngkir in 2024 and now serves real-time shipping
    | rates through its Collaborator API. New API keys issued from the
    | Komerce dashboard authenticate against api[-sandbox].collaborator.komerce.id
    | and the legacy rajaongkir.com endpoints will not register hits against
    | the new keys' quota counter.
    |
    | When `KOMERCE_ENABLED=true` and a key + origin id are present, the
    | `cost` lookup in RajaOngkirService delegates here for live pricing.
    | Provinces / cities / subdistricts continue to be served from the
    | curated mock dataset (Indonesian admin geography is static; no need
    | to spend quota on it).
    |
    | `origin_destination_id` is your store's Komerce destination id —
    | discover it once via the /shipping/search-destination admin endpoint
    | (or look up your kelurahan in the Komerce dashboard) and paste the
    | numeric id here. Without this, KomerceShippingService.enabled()
    | returns false and the legacy/mock fallback kicks in.
    |
    */
    'komerce' => [
        'enabled'               => filter_var(env('KOMERCE_ENABLED', false), FILTER_VALIDATE_BOOLEAN),
        'api_key'               => env('KOMERCE_API_KEY'),
        'base_url'              => env('KOMERCE_BASE_URL', 'https://api-sandbox.collaborator.komerce.id'),
        'origin_destination_id' => env('KOMERCE_ORIGIN_DESTINATION_ID'),
    ],
];
