<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

class AuthController
{
    public function login(Request $request){
        $validated = $request->validate([
            'email' => 'required|email',
            'password' =>'required'
        ]);
        $user = User::where('email',$validated['email'])->first();
        if(!$user){
            return response()->json(['message'=>'Email Not Found'],401);
        }
        if(!Hash::check($validated['password'],$user->password)){
            return response()->json(['message'=>'Wrong Password'],401);
        }
        return response()->json([
            'message'=> 'Login Succes',
            'user'=>[
                'id'=>$user->id,
                'name'=>$user->name,
                'phone'=>$user->phone,
                'email'=>$user->email,
                'role'=>$user->role
            ]
        ]);
    }
}
