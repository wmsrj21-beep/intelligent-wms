'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'

type PacoteInventario = {
    id: string
    barcode: string
    client_name: string
    dias: number
    encontrado: boolean
}

export default function InventarioPage() {
    const router = useRouter()
    const supabase = createClient()
    const inputRef = useRef<HTMLInputElement>(null)

    const [companyId, setCompanyId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [operatorName, setOperatorName] = useState('')

    const [fase, setFase] = useState<'inicio' | 'bipando' | 'resultado'>('inicio')
    const [inventarioId, setInventarioId] = useState('')
    const [pacotes, setPacotes] = useState<PacoteInventario[]>([])
    const [bipados, setBipados] = useState<Set<string>>(new Set())
    const [barcode, setBarcode] = useState('')
    const [feedback, setFeedback] = useState<{ msg: string; tipo: 'ok' | 'erro' | 'alerta' } | null>(null)
    const [iniciando, setIniciando] = useState(false)
    const [finalizando, setFinalizando] = useState(false)
    const [inventarioAtivo, setInventarioAtivo] = useState<any>(null)

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            setOperatorId(user.id)

            const { data: userData } = await supabase
                .from('users').select('company_id, name').eq('id', user.id).single()
            if (!userData) return
            setCompanyId(userData.company_id)
            setOperatorName(userData.name)

            // Verificar se tem inventário em andamento
            const { data: inv } = await supabase
                .from('inventories')
                .select('*')
                .eq('company_id', userData.company_id)
                .eq('status', 'em_andamento')
                .order('created_at', { ascending: false })
                .limit(1)
                .single()

            if (inv) {
                setInventarioAtivo(inv)
                await retormarInventario(inv.id, userData.company_id)
            }
        }
        init()
    }, [])

    async function retormarInventario(invId: string, cid: string) {
        const { data: items } = await supabase
            .from('inventory_items')
            .select('barcode, found, packages(id, clients(name), created_at)')
            .eq('inventory_id', invId)

        if (!items) return

        const agora = new Date()
        const pkgs = items.map((item: any) => ({
            id: item.packages?.id || '',
            barcode: item.barcode,
            client_name: item.packages?.clients?.name || '-',
            dias: Math.floor((agora.getTime() - new Date(item.packages?.created_at || agora).getTime()) / 86400000),
            encontrado: item.found
        }))

        setPacotes(pkgs)
        setBipados(new Set(items.filter((i: any) => i.found).map((i: any) => i.barcode)))
        setInventarioId(invId)
        setFase('bipando')
        setTimeout(() => inputRef.current?.focus(), 100)
    }

    async function iniciarInventario() {
        setIniciando(true)

        // Buscar todos os pacotes no armazém (exceto extravio/roubo/lost)
        const { data: pkgsData } = await supabase
            .from('packages')
            .select('id, barcode, status, created_at, clients(name)')
            .eq('company_id', companyId)
            .in('status', ['in_warehouse', 'incident'])
            .order('created_at', { ascending: true })

        if (!pkgsData || pkgsData.length === 0) {
            alert('Nenhum pacote no armazém para inventariar.')
            setIniciando(false)
            return
        }

        // Criar inventário
        const { data: inv } = await supabase
            .from('inventories')
            .insert({
                company_id: companyId,
                operator_id: operatorId,
                operator_name: operatorName,
                status: 'em_andamento',
                total_esperado: pkgsData.length,
                total_bipado: 0
            })
            .select().single()

        if (!inv) { setIniciando(false); return }

        // Criar itens do inventário
        const items = pkgsData.map((p: any) => ({
            inventory_id: inv.id,
            package_id: p.id,
            barcode: p.barcode,
            found: false
        }))

        await supabase.from('inventory_items').insert(items)

        const agora = new Date()
        const pkgs = pkgsData.map((p: any) => ({
            id: p.id,
            barcode: p.barcode,
            client_name: (p.clients as any)?.name || '-',
            dias: Math.floor((agora.getTime() - new Date(p.created_at).getTime()) / 86400000),
            encontrado: false
        }))

        setPacotes(pkgs)
        setBipados(new Set())
        setInventarioId(inv.id)
        setInventarioAtivo(inv)
        setIniciando(false)
        setFase('bipando')
        setTimeout(() => inputRef.current?.focus(), 100)
    }

    async function handleBipe(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key !== 'Enter') return
        const codigo = barcode.trim()
        if (!codigo) return
        setBarcode('')

        if (bipados.has(codigo)) {
            setFeedback({ msg: `⚠️ ${codigo} já foi bipado`, tipo: 'alerta' })
            setTimeout(() => setFeedback(null), 1500)
            inputRef.current?.focus()
            return
        }

        const pacote = pacotes.find(p => p.barcode === codigo)

        if (!pacote) {
            setFeedback({ msg: `❌ ${codigo} — não está no inventário`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        // Marcar como encontrado
        await supabase
            .from('inventory_items')
            .update({ found: true, scanned_at: new Date().toISOString() })
            .eq('inventory_id', inventarioId)
            .eq('barcode', codigo)

        const novosBipados = new Set(bipados)
        novosBipados.add(codigo)
        setBipados(novosBipados)

        // Atualizar total no inventário
        await supabase
            .from('inventories')
            .update({ total_bipado: novosBipados.size })
            .eq('id', inventarioId)

        setFeedback({ msg: `✅ ${codigo} — ${pacote.client_name}`, tipo: 'ok' })
        setTimeout(() => setFeedback(null), 1500)
        inputRef.current?.focus()
    }

    async function finalizarInventario() {
        const naoEncontrados = pacotes.filter(p => !bipados.has(p.barcode))

        if (naoEncontrados.length > 0) {
            const confirmar = window.confirm(
                `${naoEncontrados.length} pacote(s) não foram encontrados e serão marcados como Extravio. Confirma?`
            )
            if (!confirmar) return
        }

        setFinalizando(true)

        // Marcar não encontrados como extravio
        for (const pkg of naoEncontrados) {
            await supabase.from('packages')
                .update({ status: 'extravio' })
                .eq('id', pkg.id)

            await supabase.from('package_events').insert({
                package_id: pkg.id,
                company_id: companyId,
                event_type: 'extravio',
                operator_id: operatorId,
                operator_name: operatorName,
                outcome_notes: 'Não encontrado no inventário'
            })
        }

        // Finalizar inventário
        await supabase.from('inventories').update({
            status: 'finalizado',
            finished_at: new Date().toISOString(),
            total_bipado: bipados.size
        }).eq('id', inventarioId)

        setFinalizando(false)
        setFase('resultado')
    }

    function exportarRelatorio() {
        const encontrados = pacotes.filter(p => bipados.has(p.barcode))
        const naoEncontrados = pacotes.filter(p => !bipados.has(p.barcode))

        const wb = XLSX.utils.book_new()

        const rows = [
            ...encontrados.map(p => ({
                Codigo: p.barcode, Cliente: p.client_name,
                Status: 'Encontrado', Dias: p.dias
            })),
            ...naoEncontrados.map(p => ({
                Codigo: p.barcode, Cliente: p.client_name,
                Status: 'Extravio', Dias: p.dias
            }))
        ]

        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Inventário')
        XLSX.utils.book_append_sheet(wb,
            XLSX.utils.json_to_sheet(naoEncontrados.map(p => ({
                Codigo: p.barcode, Cliente: p.client_name, Dias: p.dias
            }))),
            'Extravios'
        )
        XLSX.writeFile(wb, `inventario_${new Date().toISOString().slice(0, 10)}.xlsx`)
    }

    const progresso = pacotes.length > 0
        ? Math.round((bipados.size / pacotes.length) * 100)
        : 0

    const naoEncontrados = pacotes.filter(p => !bipados.has(p.barcode))

    // ─── INICIO ───
    if (fase === 'inicio') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-lg mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-8">
                    📋 Inventário
                </h1>

                <div className="rounded-lg p-6 flex flex-col gap-4" style={{ backgroundColor: '#1a2736' }}>
                    <div className="p-4 rounded" style={{ backgroundColor: '#0f1923' }}>
                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-2">
                            Como funciona
                        </p>
                        <p className="text-slate-400 text-sm leading-relaxed">
                            O sistema carrega todos os pacotes que estão no armazém.
                            Você bipa cada pacote fisicamente. Ao finalizar, os pacotes
                            não bipados são marcados como <strong className="text-white">Extravio</strong> e
                            têm 6 dias para serem localizados antes de virarem <strong className="text-white">Lost</strong>.
                        </p>
                    </div>

                    <div className="flex gap-3 text-xs">
                        <span className="px-2 py-1 rounded font-bold" style={{ backgroundColor: '#0d2b1a', color: '#00e676' }}>
                            🟢 até 2 dias — OK
                        </span>
                        <span className="px-2 py-1 rounded font-bold" style={{ backgroundColor: '#2b1f0d', color: '#ffb300' }}>
                            🟡 3–5 dias — Alerta
                        </span>
                        <span className="px-2 py-1 rounded font-bold" style={{ backgroundColor: '#2b0d0d', color: '#ff5252' }}>
                            🔴 6+ dias — Crítico
                        </span>
                    </div>

                    <button onClick={iniciarInventario} disabled={iniciando}
                        className="py-4 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                        style={{ backgroundColor: '#00b4b4' }}>
                        {iniciando ? 'Carregando pacotes...' : '🚀 Iniciar Inventário'}
                    </button>
                </div>
            </div>
        </main>
    )

    // ─── BIPANDO ───
    if (fase === 'bipando') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-2">
                    📋 Inventário em Andamento
                </h1>
                <p className="text-slate-400 text-xs mb-4">
                    Iniciado por {operatorName}
                </p>

                {/* Barra de progresso */}
                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <div className="flex justify-between text-xs mb-2">
                        <span className="text-slate-400">{bipados.size} de {pacotes.length} bipados</span>
                        <span className="font-bold" style={{ color: '#00b4b4' }}>{progresso}%</span>
                    </div>
                    <div className="w-full rounded-full h-3" style={{ backgroundColor: '#0f1923' }}>
                        <div className="h-3 rounded-full transition-all duration-300"
                            style={{ width: `${progresso}%`, backgroundColor: '#00b4b4' }} />
                    </div>
                    <div className="flex gap-4 mt-2 text-xs">
                        <span style={{ color: '#00e676' }}>✅ {bipados.size} encontrados</span>
                        <span style={{ color: '#ff5252' }}>❌ {naoEncontrados.length} pendentes</span>
                    </div>
                </div>

                {/* Campo de bipe */}
                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <input ref={inputRef} type="text" value={barcode}
                        onChange={e => setBarcode(e.target.value)}
                        onKeyDown={handleBipe}
                        placeholder="Bipe ou digite o código e pressione Enter"
                        className="w-full px-4 py-4 rounded text-white text-lg outline-none"
                        style={{ backgroundColor: '#0f1923', border: '2px solid #00b4b4' }}
                        autoFocus />
                </div>

                {/* Feedback */}
                {feedback && (
                    <div className="rounded p-3 mb-4 text-sm font-bold"
                        style={{
                            backgroundColor: feedback.tipo === 'ok' ? '#0d2b1a' : feedback.tipo === 'alerta' ? '#2b1f0d' : '#2b0d0d',
                            color: feedback.tipo === 'ok' ? '#00e676' : feedback.tipo === 'alerta' ? '#ffb300' : '#ff5252',
                            border: `1px solid ${feedback.tipo === 'ok' ? '#00e676' : feedback.tipo === 'alerta' ? '#ffb300' : '#ff5252'}`
                        }}>
                        {feedback.msg}
                    </div>
                )}

                {/* Pendentes críticos */}
                {naoEncontrados.filter(p => p.dias >= 3).length > 0 && (
                    <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                        <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: '#ffb300' }}>
                            ⚠️ Pendentes com Alerta
                        </p>
                        <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                            {naoEncontrados.filter(p => p.dias >= 3).map(p => (
                                <div key={p.id} className="flex justify-between text-xs p-2 rounded"
                                    style={{ backgroundColor: '#0f1923' }}>
                                    <span className="text-white font-mono">{p.barcode}</span>
                                    <span style={{ color: p.dias >= 6 ? '#ff5252' : '#ffb300' }}>
                                        {p.dias}d
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <button onClick={finalizarInventario} disabled={finalizando}
                    className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                    style={{ backgroundColor: '#c0392b' }}>
                    {finalizando ? 'Finalizando...' : `Finalizar Inventário (${naoEncontrados.length} pendentes)`}
                </button>
            </div>
        </main>
    )

    // ─── RESULTADO ───
    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-lg mx-auto">
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">
                    📋 Inventário Finalizado
                </h1>

                <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#0d2b1a', border: '1px solid #00e676' }}>
                        <p className="text-2xl font-black" style={{ color: '#00e676' }}>{bipados.size}</p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00e676' }}>Encontrados</p>
                    </div>
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#2b0d0d', border: '1px solid #ff5252' }}>
                        <p className="text-2xl font-black" style={{ color: '#ff5252' }}>{naoEncontrados.length}</p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#ff5252' }}>Extravios</p>
                    </div>
                    <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        <p className="text-2xl font-black text-white">{pacotes.length}</p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1 text-slate-400">Total</p>
                    </div>
                </div>

                {naoEncontrados.length > 0 && (
                    <div className="rounded-lg p-4 mb-6" style={{ backgroundColor: '#1a2736' }}>
                        <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: '#ff5252' }}>
                            Marcados como Extravio — têm 6 dias para localização
                        </p>
                        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                            {naoEncontrados.map(p => (
                                <div key={p.id} className="flex justify-between text-xs p-2 rounded"
                                    style={{ backgroundColor: '#0f1923' }}>
                                    <span className="text-white font-mono">{p.barcode}</span>
                                    <span className="text-slate-400">{p.client_name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex gap-3">
                    <button onClick={exportarRelatorio}
                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#00b4b4' }}>
                        ⬇️ Exportar Excel
                    </button>
                    <button onClick={() => router.push('/dashboard')}
                        className="flex-1 py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        Dashboard
                    </button>
                </div>
            </div>
        </main>
    )
}