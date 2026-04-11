'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

type Cliente = {
    id: string
    name: string
    code: string | null
    active: boolean
}

type Operador = {
    id: string
    name: string
    role: string
    active: boolean
}

export default function ConfiguracoesPage() {
    const router = useRouter()
    const supabase = createClient()

    const [companyId, setCompanyId] = useState('')
    const [aba, setAba] = useState<'clientes' | 'operadores'>('clientes')

    // Clientes
    const [clientes, setClientes] = useState<Cliente[]>([])
    const [nomeCliente, setNomeCliente] = useState('')
    const [codigoCliente, setCodigoCliente] = useState('')
    const [salvandoCliente, setSalvandoCliente] = useState(false)
    const [erroCliente, setErroCliente] = useState('')

    // Operadores
    const [operadores, setOperadores] = useState<Operador[]>([])
    const [nomeOp, setNomeOp] = useState('')
    const [emailOp, setEmailOp] = useState('')
    const [senhaOp, setSenhaOp] = useState('')
    const [roleOp, setRoleOp] = useState('operator')
    const [salvandoOp, setSalvandoOp] = useState(false)
    const [erroOp, setErroOp] = useState('')
    const [sucessoOp, setSucessoOp] = useState('')

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }

            const { data: userData } = await supabase
                .from('users').select('company_id, role').eq('id', user.id).single()
            if (!userData) return
            if (userData.role !== 'admin') { router.push('/dashboard'); return }
            setCompanyId(userData.company_id)

            await carregarClientes(userData.company_id)
            await carregarOperadores(userData.company_id)
        }
        init()
    }, [])

    async function carregarClientes(cid: string) {
        const { data } = await supabase
            .from('clients').select('*').eq('company_id', cid).order('name')
        setClientes(data || [])
    }

    async function carregarOperadores(cid: string) {
        const { data } = await supabase
            .from('users').select('*').eq('company_id', cid).order('name')
        setOperadores(data || [])
    }

    async function adicionarCliente() {
        if (!nomeCliente.trim()) { setErroCliente('Nome obrigatório'); return }
        setSalvandoCliente(true)
        setErroCliente('')

        const { error } = await supabase.from('clients').insert({
            company_id: companyId,
            name: nomeCliente.trim(),
            code: codigoCliente.trim() || null,
            active: true
        })

        if (error) {
            setErroCliente('Erro ao salvar cliente')
        } else {
            setNomeCliente('')
            setCodigoCliente('')
            await carregarClientes(companyId)
        }
        setSalvandoCliente(false)
    }

    async function toggleClienteAtivo(id: string, ativo: boolean) {
        await supabase.from('clients').update({ active: !ativo }).eq('id', id)
        await carregarClientes(companyId)
    }

    async function adicionarOperador() {
        if (!nomeOp.trim() || !emailOp.trim() || !senhaOp.trim()) {
            setErroOp('Nome, email e senha são obrigatórios')
            return
        }
        setSalvandoOp(true)
        setErroOp('')
        setSucessoOp('')

        // Cria usuário no Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.admin
            ? { data: null, error: { message: 'Use o painel do Supabase para criar usuários' } }
            : { data: null, error: { message: 'Use o painel do Supabase para criar usuários' } }

        // Como não temos acesso admin pelo frontend, orientamos o usuário
        setErroOp('')
        setSucessoOp(`Para adicionar "${nomeOp}", vá em Supabase → Authentication → Users → Add User com email: ${emailOp}. Depois volte aqui e ele aparecerá automaticamente após fazer login.`)
        setSalvandoOp(false)
    }

    async function toggleOperadorAtivo(id: string, ativo: boolean) {
        await supabase.from('users').update({ active: !ativo }).eq('id', id)
        await carregarOperadores(companyId)
    }

    const roleLabel: Record<string, string> = {
        admin: '👑 Admin',
        monitor: '👁️ Monitor',
        operator: '📦 Operador',
        viewer: '👤 Visualizador'
    }

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">
                    ⚙️ Configurações
                </h1>

                {/* Abas */}
                <div className="flex gap-2 mb-6">
                    <button onClick={() => setAba('clientes')}
                        className="px-6 py-2 rounded font-black tracking-widest uppercase text-sm"
                        style={{
                            backgroundColor: aba === 'clientes' ? '#00b4b4' : '#1a2736',
                            color: 'white'
                        }}>
                        Clientes
                    </button>
                    <button onClick={() => setAba('operadores')}
                        className="px-6 py-2 rounded font-black tracking-widest uppercase text-sm"
                        style={{
                            backgroundColor: aba === 'operadores' ? '#00b4b4' : '#1a2736',
                            color: 'white'
                        }}>
                        Operadores
                    </button>
                </div>

                {/* ─── CLIENTES ─── */}
                {aba === 'clientes' && (
                    <div className="flex flex-col gap-4">

                        {/* Formulário */}
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">
                                Novo Cliente
                            </p>
                            <div className="flex flex-col gap-3">
                                <input value={nomeCliente} onChange={e => setNomeCliente(e.target.value)}
                                    placeholder="Nome do cliente (ex: Amazon, Shopee)"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                <input value={codigoCliente} onChange={e => setCodigoCliente(e.target.value.toUpperCase())}
                                    placeholder="Código (opcional, ex: AMZ)"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                {erroCliente && (
                                    <p className="text-xs font-bold" style={{ color: '#ff5252' }}>{erroCliente}</p>
                                )}
                                <button onClick={adicionarCliente} disabled={salvandoCliente}
                                    className="py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                                    style={{ backgroundColor: '#00b4b4' }}>
                                    {salvandoCliente ? 'Salvando...' : 'Adicionar Cliente'}
                                </button>
                            </div>
                        </div>

                        {/* Lista */}
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">
                                Clientes Cadastrados — {clientes.length}
                            </p>
                            <div className="flex flex-col gap-2">
                                {clientes.map(c => (
                                    <div key={c.id} className="flex items-center justify-between p-3 rounded"
                                        style={{ backgroundColor: '#0f1923' }}>
                                        <div>
                                            <p className="text-white font-bold text-sm">{c.name}</p>
                                            {c.code && (
                                                <p className="text-slate-400 text-xs">{c.code}</p>
                                            )}
                                        </div>
                                        <button onClick={() => toggleClienteAtivo(c.id, c.active)}
                                            className="px-3 py-1 rounded text-xs font-bold tracking-widest uppercase"
                                            style={{
                                                backgroundColor: c.active ? '#0d2b1a' : '#2b0d0d',
                                                color: c.active ? '#00e676' : '#ff5252',
                                                border: `1px solid ${c.active ? '#00e676' : '#ff5252'}`
                                            }}>
                                            {c.active ? 'Ativo' : 'Inativo'}
                                        </button>
                                    </div>
                                ))}
                                {clientes.length === 0 && (
                                    <p className="text-slate-500 text-sm">Nenhum cliente cadastrado</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── OPERADORES ─── */}
                {aba === 'operadores' && (
                    <div className="flex flex-col gap-4">

                        {/* Aviso */}
                        <div className="rounded-lg p-4" style={{ backgroundColor: '#2b1f0d', border: '1px solid #ffb300' }}>
                            <p className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: '#ffb300' }}>
                                Como adicionar operadores
                            </p>
                            <p className="text-slate-400 text-xs leading-relaxed">
                                Vá em <strong className="text-white">Supabase → Authentication → Users → Add User</strong>,
                                crie o usuário com email e senha. Na primeira vez que ele fizer login,
                                o perfil será vinculado automaticamente.
                            </p>
                        </div>

                        {/* Lista de operadores */}
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">
                                Operadores Cadastrados — {operadores.length}
                            </p>
                            <div className="flex flex-col gap-2">
                                {operadores.map(op => (
                                    <div key={op.id} className="flex items-center justify-between p-3 rounded"
                                        style={{ backgroundColor: '#0f1923' }}>
                                        <div>
                                            <p className="text-white font-bold text-sm">{op.name}</p>
                                            <p className="text-slate-400 text-xs">{roleLabel[op.role] || op.role}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <select
                                                value={op.role}
                                                onChange={async e => {
                                                    await supabase.from('users').update({ role: e.target.value }).eq('id', op.id)
                                                    await carregarOperadores(companyId)
                                                }}
                                                className="px-2 py-1 rounded text-xs outline-none"
                                                style={{ backgroundColor: '#1a2736', color: 'white', border: '1px solid #2a3f52' }}>
                                                <option value="admin">Admin</option>
                                                <option value="monitor">Monitor</option>
                                                <option value="operator">Operador</option>
                                                <option value="viewer">Visualizador</option>
                                            </select>
                                            <button onClick={() => toggleOperadorAtivo(op.id, op.active)}
                                                className="px-3 py-1 rounded text-xs font-bold tracking-widest uppercase"
                                                style={{
                                                    backgroundColor: op.active ? '#0d2b1a' : '#2b0d0d',
                                                    color: op.active ? '#00e676' : '#ff5252',
                                                    border: `1px solid ${op.active ? '#00e676' : '#ff5252'}`
                                                }}>
                                                {op.active ? 'Ativo' : 'Inativo'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {operadores.length === 0 && (
                                    <p className="text-slate-500 text-sm">Nenhum operador cadastrado</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </main>
    )
}