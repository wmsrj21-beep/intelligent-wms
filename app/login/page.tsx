'use client'

import { useState } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const router = useRouter()
    const supabase = createClient()

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault()
        setLoading(true)
        setError('')

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

        if (error) {
            setError('Email ou senha incorretos.')
            setLoading(false)
            return
        }

        router.push('/dashboard')
    }

    return (
        <main className="min-h-screen flex" style={{ backgroundColor: '#0f1923' }}>

            {/* Lado esquerdo — identidade */}
            <div className="hidden lg:flex w-1/2 flex-col items-center justify-center gap-6 px-16"
                style={{ backgroundColor: '#0d1720' }}>
                <div className="text-center">
                    <div className="text-6xl mb-6">🏭</div>
                    <h1 className="text-4xl font-black tracking-widest uppercase text-white">
                        Intelligent WMS
                    </h1>
                    <p className="mt-3 tracking-widest uppercase text-sm"
                        style={{ color: '#00b4b4' }}>
                        Sistema de Gestão de Armazém
                    </p>
                    <p className="mt-6 text-slate-400 text-sm leading-relaxed max-w-sm">
                        Controle completo de armazém e rua. Rastreabilidade total de pacotes,
                        motoristas e operações em tempo real.
                    </p>
                </div>
            </div>

            {/* Lado direito — formulário */}
            <div className="w-full lg:w-1/2 flex items-center justify-center px-8">
                <div className="w-full max-w-md">

                    {/* Logo mobile */}
                    <div className="lg:hidden text-center mb-10">
                        <h1 className="text-3xl font-black tracking-widest uppercase text-white">
                            Intelligent WMS
                        </h1>
                        <p className="mt-1 tracking-widest uppercase text-xs"
                            style={{ color: '#00b4b4' }}>
                            Sistema de Gestão de Armazém
                        </p>
                    </div>

                    <div className="rounded-lg p-8" style={{ backgroundColor: '#1a2736' }}>
                        <h2 className="text-xl font-black tracking-widest uppercase text-white mb-8">
                            Acessar Sistema
                        </h2>

                        <form onSubmit={handleLogin} className="flex flex-col gap-5">

                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                                    Email
                                </label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="seu@email.com"
                                    required
                                    className="px-4 py-3 rounded text-white text-sm outline-none focus:ring-2"
                                    style={{
                                        backgroundColor: '#0f1923',
                                        border: '1px solid #2a3f52',
                                        focusRingColor: '#00b4b4'
                                    }}
                                />
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                                    Senha
                                </label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{
                                        backgroundColor: '#0f1923',
                                        border: '1px solid #2a3f52'
                                    }}
                                />
                            </div>

                            {error && (
                                <p className="text-red-400 text-xs tracking-wide">{error}</p>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="mt-2 py-3 rounded font-black tracking-widest uppercase text-white text-sm transition-opacity disabled:opacity-50"
                                style={{ backgroundColor: '#00b4b4' }}
                            >
                                {loading ? 'Entrando...' : 'Entrar'}
                            </button>

                        </form>
                    </div>

                    <p className="text-center text-slate-600 text-xs mt-6 tracking-wider">
                        Intelligent WMS © {new Date().getFullYear()}
                    </p>
                </div>
            </div>

        </main>
    )
}