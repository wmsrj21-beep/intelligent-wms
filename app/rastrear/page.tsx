'use client'

import { useState } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

type Evento = {
    id: string
    event_type: string
    operator_name: string
    driver_name: string | null
    location: string | null
    outcome: string | null
    outcome_notes: string | null
    has_divergence: boolean
    divergence_type: string | null
    divergence_notes: string | null
    created_at: string
}

type Pacote = {
    id: string
    barcode: string
    status: string
    created_at: string
    clients: { name: string }
    package_events: Evento[]
}

const statusLabel: Record<string, string> = {
    in_warehouse: '📦 No Armazém',
    dispatched: '🚚 Expedido',
    delivered: '✅ Entregue',
    unsuccessful: '⚠️ Insucesso',
    returned: '↩️ Devolvido',
}

const eventLabel: Record<string, string> = {
    received: '📥 Recebido',
    moved: '🔄 Movido',
    picked: '🤚 Separado',
    dispatched: '🚚 Expedido',
    delivered: '✅ Entregue',
    unsuccessful: '⚠️ Insucesso',
    returned: '↩️ Devolvido',
}

export default function RastrearPage() {
    const router = useRouter()
    const supabase = createClient()
    const [barcode, setBarcode] = useState('')
    const [pacote, setPacote] = useState<Pacote | null>(null)
    const [erro, setErro] = useState('')
    const [loading, setLoading] = useState(false)

    async function buscar() {
        if (!barcode.trim()) return
        setLoading(true)
        setErro('')
        setPacote(null)

        const { data, error } = await supabase
            .from('packages')
            .select(`
        id, barcode, status, created_at,
        clients(name),
        package_events(
          id, event_type, operator_name, driver_name,
          location, outcome, outcome_notes,
          has_divergence, divergence_type, divergence_notes,
          created_at
        )
      `)
            .eq('barcode', barcode.trim())
            .single()

        setLoading(false)

        if (error || !data) {
            setErro('Pacote não encontrado.')
            return
        }

        const sorted = {
            ...data,
            package_events: [...data.package_events].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
        }
        setPacote(sorted as any)
    }

    function formatDate(dt: string) {
        return new Date(dt).toLocaleString('pt-BR')
    }

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">
                    🔍 Rastrear Pacote
                </h1>

                {/* Campo de busca */}
                <div className="flex gap-3 mb-6">
                    <input
                        type="text"
                        value={barcode}
                        onChange={e => setBarcode(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && buscar()}
                        placeholder="Digite ou bipe o código do pacote"
                        className="flex-1 px-4 py-3 rounded text-white text-sm outline-none"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}
                        autoFocus
                    />
                    <button onClick={buscar} disabled={loading}
                        className="px-6 py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                        style={{ backgroundColor: '#00b4b4' }}>
                        {loading ? '...' : 'Buscar'}
                    </button>
                </div>

                {/* Erro */}
                {erro && (
                    <div className="rounded p-4 mb-4 text-sm font-bold"
                        style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>
                        {erro}
                    </div>
                )}

                {/* Resultado */}
                {pacote && (
                    <div className="flex flex-col gap-4">

                        {/* Header do pacote */}
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <div className="flex items-start justify-between">
                                <div>
                                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-1">
                                        Código
                                    </p>
                                    <p className="text-white font-black text-xl font-mono">{pacote.barcode}</p>
                                </div>
                                <span className="px-3 py-1 rounded text-xs font-bold tracking-widest uppercase"
                                    style={{ backgroundColor: '#0f1923', color: '#00b4b4' }}>
                                    {statusLabel[pacote.status] || pacote.status}
                                </span>
                            </div>
                            <div className="mt-4 flex gap-6">
                                <div>
                                    <p className="text-xs text-slate-400">Cliente</p>
                                    <p className="text-white font-bold text-sm">{(pacote.clients as any)?.name}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400">Entrada</p>
                                    <p className="text-white font-bold text-sm">{formatDate(pacote.created_at)}</p>
                                </div>
                            </div>
                        </div>

                        {/* Timeline de eventos */}
                        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">
                                Histórico Completo
                            </p>

                            <div className="flex flex-col gap-0">
                                {pacote.package_events.map((ev, i) => (
                                    <div key={ev.id} className="flex gap-4">
                                        {/* Linha do tempo */}
                                        <div className="flex flex-col items-center">
                                            <div className="w-3 h-3 rounded-full mt-1 flex-shrink-0"
                                                style={{ backgroundColor: '#00b4b4' }} />
                                            {i < pacote.package_events.length - 1 && (
                                                <div className="w-px flex-1 my-1" style={{ backgroundColor: '#2a3f52' }} />
                                            )}
                                        </div>

                                        {/* Conteúdo */}
                                        <div className="pb-4 flex-1">
                                            <div className="flex items-center justify-between">
                                                <p className="text-white font-bold text-sm">
                                                    {eventLabel[ev.event_type] || ev.event_type}
                                                </p>
                                                <p className="text-slate-500 text-xs">{formatDate(ev.created_at)}</p>
                                            </div>

                                            {ev.operator_name && (
                                                <p className="text-slate-400 text-xs mt-1">
                                                    👤 Operador: {ev.operator_name}
                                                </p>
                                            )}
                                            {ev.driver_name && (
                                                <p className="text-slate-400 text-xs mt-1">
                                                    🚗 Motorista: {ev.driver_name}
                                                </p>
                                            )}
                                            {ev.location && (
                                                <p className="text-slate-400 text-xs mt-1">
                                                    📍 Local: {ev.location}
                                                </p>
                                            )}
                                            {ev.outcome && (
                                                <p className="text-xs mt-1 font-bold"
                                                    style={{ color: ev.outcome === 'delivered' ? '#00e676' : '#ffb300' }}>
                                                    Resultado: {ev.outcome}
                                                </p>
                                            )}
                                            {ev.has_divergence && (
                                                <div className="mt-2 px-3 py-2 rounded text-xs"
                                                    style={{ backgroundColor: '#2b1f0d', color: '#ffb300', border: '1px solid #ffb300' }}>
                                                    ⚠️ Divergência: {ev.divergence_type} — {ev.divergence_notes}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>
                )}
            </div>
        </main>
    )
}