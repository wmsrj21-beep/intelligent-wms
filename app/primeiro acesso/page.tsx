'use client'

import { useState } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

export default function PrimeiroAcessoPage() {
    const router = useRouter()
    const supabase = createClient()

    const [novaSenha, setNovaSenha] = useState('')
    const [confirmarSenha, setConfirmarSenha] = useState('')
    const [salvando, setSalvando] = useState(false)
    const [erro, setErro] = useState('')

    async function salvarSenha() {
        setErro('')

        if (novaSenha.length < 6) {
            setErro('A senha deve ter pelo menos 6 caracteres.')
            return
        }

        if (novaSenha !== confirmarSenha) {
            setErro('As senhas não coincidem.')
            return
        }

        if (novaSenha === 'Teste@123') {
            setErro('Escolha uma senha diferente da senha padrão.')
            return
        }

        setSalvando(true)

        const { error: authError } = await supabase.auth.updateUser({ password: novaSenha })

        if (authError) {
            setErro('Erro ao atualizar senha. Tente novamente.')
            setSalvando(false)
            return
        }

        // Marca first_login como false
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            await supabase.from('users').update({ first_login: false }).eq('id', user.id)
        }

        setSalvando(false)
        router.push('/dashboard')
    }

    return (
        <main className="min-h-screen flex items-center justify-center p-6"
            style={{ backgroundColor: '#0f1923' }}>
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <h1 className="text-white font-black tracking-widest uppercase text-xl mb-2">
                        Intelligent WMS
                    </h1>
                    <p className="text-xs tracking-widest uppercase" style={{ color: '#00b4b4' }}>
                        Primeiro Acesso
                    </p>
                </div>

                <div className="rounded-lg p-6 flex flex-col gap-5" style={{ backgroundColor: '#1a2736' }}>
                    <div className="rounded p-3" style={{ backgroundColor: '#2b1f0d', border: '1px solid #ffb300' }}>
                        <p className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: '#ffb300' }}>
                            ⚠️ Troca de senha obrigatória
                        </p>
                        <p className="text-slate-400 text-xs">
                            Este é seu primeiro acesso. Por segurança, você precisa definir uma nova senha antes de continuar.
                        </p>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                            Nova Senha
                        </label>
                        <input
                            type="password"
                            value={novaSenha}
                            onChange={e => setNovaSenha(e.target.value)}
                            placeholder="Mínimo 6 caracteres"
                            className="px-4 py-3 rounded text-white text-sm outline-none"
                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                            Confirmar Nova Senha
                        </label>
                        <input
                            type="password"
                            value={confirmarSenha}
                            onChange={e => setConfirmarSenha(e.target.value)}
                            placeholder="Repita a senha"
                            className="px-4 py-3 rounded text-white text-sm outline-none"
                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}
                            onKeyDown={e => e.key === 'Enter' && salvarSenha()}
                        />
                    </div>

                    {erro && (
                        <div className="rounded p-3 text-xs font-bold"
                            style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>
                            ❌ {erro}
                        </div>
                    )}

                    <button onClick={salvarSenha} disabled={salvando}
                        className="py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                        style={{ backgroundColor: '#00b4b4' }}>
                        {salvando ? 'Salvando...' : 'Definir Nova Senha'}
                    </button>
                </div>
            </div>
        </main>
    )
}