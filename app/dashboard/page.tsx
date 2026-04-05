'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

export default function DashboardPage() {
    const [user, setUser] = useState<any>(null)
    const router = useRouter()
    const supabase = createClient()

    useEffect(() => {
        async function getUser() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                router.push('/login')
                return
            }
            setUser(user)
        }
        getUser()
    }, [])

    async function handleLogout() {
        await supabase.auth.signOut()
        router.push('/login')
    }

    if (!user) return null

    return (
        <main className="min-h-screen" style={{ backgroundColor: '#0f1923' }}>

            {/* Header */}
            <header className="px-6 py-4 flex items-center justify-between"
                style={{ backgroundColor: '#0d1720', borderBottom: '1px solid #1a2736' }}>
                <div>
                    <h1 className="text-white font-black tracking-widest uppercase text-lg">
                        Intelligent WMS
                    </h1>
                    <p className="text-xs tracking-widest uppercase" style={{ color: '#00b4b4' }}>
                        Painel de Controle
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-slate-400 text-sm">{user.email}</span>
                    <button
                        onClick={handleLogout}
                        className="px-4 py-2 rounded text-xs font-bold tracking-widest uppercase text-white"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        Sair
                    </button>
                </div>
            </header>

            {/* Cards */}
            <div className="p-6 grid grid-cols-2 lg:grid-cols-4 gap-4">

                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">
                        Pacotes Hoje
                    </p>
                    <p className="text-3xl font-black text-white mt-2">0</p>
                    <p className="text-xs text-slate-500 mt-1">Entradas registradas</p>
                </div>

                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">
                        No Armazém
                    </p>
                    <p className="text-3xl font-black text-white mt-2">0</p>
                    <p className="text-xs text-slate-500 mt-1">Pacotes em estoque</p>
                </div>

                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">
                        Expedidos Hoje
                    </p>
                    <p className="text-3xl font-black text-white mt-2">0</p>
                    <p className="text-xs text-slate-500 mt-1">Saídas registradas</p>
                </div>

                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">
                        Divergências
                    </p>
                    <p className="text-3xl font-black text-white mt-2">0</p>
                    <p className="text-xs text-slate-500 mt-1">Pendentes hoje</p>
                </div>

            </div>

            {/* Menu de módulos */}
            <div className="px-6 grid grid-cols-2 lg:grid-cols-3 gap-4">

                <button className="rounded-lg p-6 text-left transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                    <div className="text-3xl mb-3">📦</div>
                    <p className="text-white font-black tracking-widest uppercase text-sm">Recebimento</p>
                    <p className="text-slate-400 text-xs mt-1">Entrada de pacotes</p>
                </button>

                <button className="rounded-lg p-6 text-left transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                    <div className="text-3xl mb-3">🏭</div>
                    <p className="text-white font-black tracking-widest uppercase text-sm">Armazém</p>
                    <p className="text-slate-400 text-xs mt-1">Movimentação interna</p>
                </button>

                <button className="rounded-lg p-6 text-left transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                    <div className="text-3xl mb-3">🚚</div>
                    <p className="text-white font-black tracking-widest uppercase text-sm">Expedição</p>
                    <p className="text-slate-400 text-xs mt-1">Saída de pacotes</p>
                </button>

                <button className="rounded-lg p-6 text-left transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                    <div className="text-3xl mb-3">🛣️</div>
                    <p className="text-white font-black tracking-widest uppercase text-sm">Rua</p>
                    <p className="text-slate-400 text-xs mt-1">Pátio e motoristas</p>
                </button>

                <button className="rounded-lg p-6 text-left transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                    <div className="text-3xl mb-3">🔍</div>
                    <p className="text-white font-black tracking-widest uppercase text-sm">Rastrear</p>
                    <p className="text-slate-400 text-xs mt-1">Buscar pacote</p>
                </button>

                <button className="rounded-lg p-6 text-left transition-opacity hover:opacity-80"
                    style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                    <div className="text-3xl mb-3">⚙️</div>
                    <p className="text-white font-black tracking-widest uppercase text-sm">Configurações</p>
                    <p className="text-slate-400 text-xs mt-1">Clientes e operadores</p>
                </button>

            </div>

        </main>
    )
}