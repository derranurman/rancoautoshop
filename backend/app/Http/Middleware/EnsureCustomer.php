<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureCustomer
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (! $user || ! $user->isCustomer()) {
            return response()->json(['message' => 'Forbidden. Customer only.'], 403);
        }
        return $next($request);
    }
}
