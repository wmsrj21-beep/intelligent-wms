'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'

type MotoristaStatus = {
    motorista_id: string
    motorista_nome: string
    placa: string
    total: number
    entregues: number
    insucessos: number
    em_rota: number
    sem_info: number
    pendente: boolean
}

const STATUS_ENTREGUE = ['Delivered']
const STATUS_INSUCESSO = ['Marked For Reprocess', 'Marked for problem', 'Marked For Problem']
const STATUS_EM_ROTA = ['In Transit']

export default function ConciliacaoPage() {
    const router = useRouter()
    const supabase = createClient()

    const [companyId, setCompanyId] = useState('')
    const [motoristas, setMotoristas] = useState<MotoristaStatus[]>([])
    const [loading, setLoading] = useState(true)
    const [processando, setProcessando] = useState(false)
    const [arquivoCarregado, setArquivoCarregado] = useState(false)
    const [arquivoNome, setArquivoNome] = useState('')
    const [arquivoDados, setArquivoDados] = useState<Record<string, string>>({})
    const [expandido, setExpandido] = useState<string | null>(null)
    const [detalhesPacotes, setDetalhesPacotes] = useState<Record<string, {
        entregues: string[], insucessos: string[], em_rota: string[], sem_info: string[]
    }>>({})

    const carregarMotoristas = useCallback(async (cid: string) => {
        const hoje = new Date()
        hoje.setHours(0, 0, 0, 0)

        const { data: eventos } = await supabase
            .from('package_events')
            .select(`driver_id, driver_name, packages(id, barcode, status), drivers(name, license_plate)`)
            .eq('company_id', cid)
            .eq('event_type', 'dispatched')
            .gte('created_at', hoje.toISOString())

        if (!eventos || eventos.length === 0) {
            setMotoristas([])
            setLoading(false)
            return
        }

        const agrupado: Record<string, MotoristaStatus> = {}
        const detalhes: Record<string, { entregues: string[], insucessos: string[], em_rota: string[], sem_info: string[] }> = {}

        for (const ev of eventos) {
            const driverId = ev.driver_id
            if (!driverId) continue
            const barcode = (ev.packages as any)?.barcode
            const pkgStatus = (ev.packages as any)?.status
            if (!barcode) continue

            if (!agrupado[driverId]) {
                agrupado[driverId] = {
                    motorista_id: driverId,
                    motorista_nome: ev.driver_name || (ev.drivers as any)?.name || '-',
                    placa: (ev.drivers as any)?.license_plate || '-',
                    total: 0,
                    entregues: 0,
                    insucessos: 0,
                    em_rota: 0,
                    sem_info: 0,
                    pendente: false
                }
                detalhes[driverId] = { entregues: [], insucessos: [], em_rota: [], sem_info: [] }
            }

            agrupado[driverId].total++

            if (pkgStatus === 'delivered') {
                agrupado[driverId].entregues++
                detalhes[driverId].entregues.push(barcode)
            } else if (pkgStatus === 'unsuccessful') {
                agrupado[driverId].insucessos++
                detalhes[driverId].insucessos.push(barcode)
                agrupado[driverId].pendente = true
            } else if (pkgStatus === 'dispatched') {
                agrupado[driverId].em_rota++
                detalhes[driverId].em_rota.push(barcode)
            } else {
                agrupado[driverId].sem_info++
                detalhes[driverId].sem_info.push(barcode)
            }
        }

        setMotoristas(Object.values(agrupado))
        setDetalhesPacotes(detalhes)
        setLoading(false)
    }, [supabase])

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            const { data: userData } = await supabase
                .from('users').select('company_id').eq('id', user.id).single()
            if (!userData) return
            setCompanyId(userData.company_id)
            await carregarMotoristas(userData.company_id)
        }
        init()
    }, [])

    function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        setArquivoNome(file.name)

        const reader = new FileReader()
        reader.onload = (evt) => {
            const text = evt.target?.result as string
            const linhas = text.split('\n').slice(1)
            const mapa: Record<string, { status: string; time: string }> = {}

            for (const linha of linhas) {
                if (!linha.trim()) continue
                const cols = linha.replace(/^"|"$/g, '').split('","')
                if (cols.length < 4) continue
                const trackingId = cols[0]?.trim()
                const time = cols[1]?.trim()
                const state = cols[3]?.trim()
                if (!trackingId || !state) continue

                if (!mapa[trackingId] || time > mapa[trackingId].time) {
                    mapa[trackingId] = { status: state, time }
                }
            }

            const resultado: Record<string, string> = {}
            for (const [id, val] of Object.entries(mapa)) {
                resultado[id] = val.status
            }
            setArquivoDados(resultado)
            setArquivoCarregado(true)
        }
        reader.readAsText(file, 'utf-8')
    }

    async function processar() {
        if (Object.keys(arquivoDados).length === 0) return
        setProcessando(true)

        const hoje = new Date()
        hoje.setHours(0, 0, 0, 0)

        const { data: eventos } = await supabase
            .from('package_events')
            .select(`driver_id, driver_name, packages(id, barcode, status), drivers(name, license_plate)`)
            .eq('company_id', companyId)
            .eq('event_type', 'dispatched')
            .gte('created_at', hoje.toISOString())

        if (!eventos) { setProcessando(false); return }

        for (const ev of eventos) {
            const driverId = ev.driver_id
            const barcode = (ev.packages as any)?.barcode
            const pkgId = (ev.packages as any)?.id
            if (!barcode || !pkgId) continue

            const statusAmazon = arquivoDados[barcode]
            if (!statusAmazon) continue

            if (STATUS_ENTREGUE.includes(statusAmazon)) {
                await supabase.from('packages').update({ status: 'delivered' }).eq('id', pkgId)
                await supabase.from('package_events').insert({
                    package_id: pkgId, company_id: companyId,
                    event_type: 'delivered', outcome: 'delivered',
                    driver_id: driverId, driver_name: ev.driver_name
                })
            } else if (STATUS_INSUCESSO.some(s => statusAmazon.toLowerCase().includes(s.toLowerCase()))) {
                await supabase.from('packages').update({ status: 'unsuccessful' }).eq('id', pkgId)
                await supabase.from('package_events').insert({
                    package_id: pkgId, company_id: companyId,
                    event_type: 'unsuccessful', outcome: 'unsuccessful',
                    driver_id: driverId, driver_name: ev.driver_name
                })
            }
        }

        await carregarMotoristas(companyId)
        setProcessando(false)
        setArquivoCarregado(false)
        setArquivoNome('')
        setArquivoDados({})
    }

    function progresso(m: MotoristaStatus) {
        if (m.total === 0) return 0
        return Math.round((m.entregues / m.total) * 100)
    }

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-3xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-white font-black tracking-widest uppercase text-xl">
                            🔄 Monitoramento de Rua
                        </h1>
                        <p className="text-slate-400 text-xs mt-1">
                            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
                        </p>
                    </div>

                    {/* Upload */}
                    <div className="flex items-center gap-3">
                        {arquivoCarregado && (
                            <button onClick={processar} disabled={processando}
                                className="px-4 py-2 rounded font-black tracking-widest uppercase text-white text-xs disabled:opacity-50"
                                style={{ backgroundColor: '#00e676', color: '#0f1923' }}>
                                {processando ? 'Processando...' : `Processar (${Object.keys(arquivoDados).length} pacotes)`}
                            </button>
                        )}
                        <label className="px-4 py-2 rounded font-black tracking-widest uppercase text-xs cursor-pointer"
                            style={{ backgroundColor: '#00b4b4', color: 'white' }}>
                            {arquivoNome ? `📁 ${arquivoNome.substring(0, 15)}...` : '📁 Arquivo Cortex'}
                            <input type="file" accept=".csv" onChange={handleUpload} className="hidden" />
                        </label>
                    </div>
                </div>

                {/* Totais gerais */}
                {motoristas.length > 0 && (
                    <div className="grid grid-cols-4 gap-3 mb-6">
                        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#0d2b1a', border: '1px solid #00e676' }}>
                            <p className="text-2xl font-black" style={{ color: '#00e676' }}>
                                {motoristas.reduce((a, m) => a + m.entregues, 0)}
                            </p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00e676' }}>Entregues</p>
                        </div>
                        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#2b0d0d', border: '1px solid #ff5252' }}>
                            <p className="text-2xl font-black" style={{ color: '#ff5252' }}>
                                {motoristas.reduce((a, m) => a + m.insucessos, 0)}
                            </p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#ff5252' }}>Insucessos</p>
                        </div>
                        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#1a2736', border: '1px solid #00b4b4' }}>
                            <p className="text-2xl font-black" style={{ color: '#00b4b4' }}>
                                {motoristas.reduce((a, m) => a + m.em_rota, 0)}
                            </p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00b4b4' }}>Em Rota</p>
                        </div>
                        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                            <p className="text-2xl font-black text-slate-400">
                                {motoristas.reduce((a, m) => a + m.total, 0)}
                            </p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1 text-slate-500">Total</p>
                        </div>
                    </div>
                )}

                {/* Lista de motoristas */}
                {loading ? (
                    <p className="text-slate-400 text-sm">Carregando...</p>
                ) : motoristas.length === 0 ? (
                    <div className="rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                        <p className="text-slate-400">Nenhuma expedição registrada hoje ainda.</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {motoristas.map(m => (
                            <div key={m.motorista_id} className="rounded-lg overflow-hidden"
                                style={{ backgroundColor: '#1a2736', border: m.pendente ? '1px solid #ff5252' : '1px solid #1a2736' }}>

                                {/* Header do motorista */}
                                <button onClick={() => setExpandido(expandido === m.motorista_id ? null : m.motorista_id)}
                                    className="w-full p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="text-left">
                                            <div className="flex items-center gap-2">
                                                <p className="text-white font-bold">{m.motorista_nome}</p>
                                                {m.pendente && (
                                                    <span className="px-2 py-0.5 rounded text-xs font-bold"
                                                        style={{ backgroundColor: '#2b0d0d', color: '#ff5252' }}>
                                                        ⚠️ PENDÊNCIA
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-slate-400 text-xs">{m.placa} · {m.total} pacotes</p>
                                        </div>
                                        <div className="flex gap-4 text-sm font-bold">
                                            <span style={{ color: '#00e676' }}>✅ {m.entregues}</span>
                                            <span style={{ color: '#ff5252' }}>❌ {m.insucessos}</span>
                                            <span style={{ color: '#00b4b4' }}>🚚 {m.em_rota}</span>
                                            <span className="text-slate-500">⚪ {m.sem_info}</span>
                                            <span className="text-slate-400 ml-1">{expandido === m.motorista_id ? '▲' : '▼'}</span>
                                        </div>
                                    </div>

                                    {/* Barra de progresso */}
                                    <div className="w-full rounded-full h-2" style={{ backgroundColor: '#0f1923' }}>
                                        <div className="h-2 rounded-full transition-all duration-500"
                                            style={{
                                                width: `${progresso(m)}%`,
                                                backgroundColor: m.insucessos > 0 ? '#ffb300' : '#00e676'
                                            }} />
                                    </div>
                                    <div className="flex justify-between mt-1">
                                        <span className="text-xs text-slate-500">{progresso(m)}% concluído</span>
                                        <span className="text-xs text-slate-500">{m.entregues + m.insucessos} de {m.total}</span>
                                    </div>
                                </button>

                                {/* Detalhes expandidos */}
                                {expandido === m.motorista_id && detalhesPacotes[m.motorista_id] && (
                                    <div className="px-4 pb-4 flex flex-col gap-3 border-t" style={{ borderColor: '#0f1923' }}>

                                        {detalhesPacotes[m.motorista_id].insucessos.length > 0 && (
                                            <div className="mt-3">
                                                <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: '#ff5252' }}>
                                                    ❌ Insucessos — precisam voltar pra base
                                                </p>
                                                <div className="flex flex-col gap-1">
                                                    {detalhesPacotes[m.motorista_id].insucessos.map(b => (
                                                        <p key={b} className="text-sm font-mono px-3 py-1 rounded"
                                                            style={{ backgroundColor: '#2b0d0d', color: '#ff5252' }}>{b}</p>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {detalhesPacotes[m.motorista_id].em_rota.length > 0 && (
                                            <div>
                                                <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: '#00b4b4' }}>
                                                    🚚 Em Rota
                                                </p>
                                                <div className="flex flex-col gap-1">
                                                    {detalhesPacotes[m.motorista_id].em_rota.slice(0, 5).map(b => (
                                                        <p key={b} className="text-sm font-mono px-3 py-1 rounded"
                                                            style={{ backgroundColor: '#0f1923', color: '#00b4b4' }}>{b}</p>
                                                    ))}
                                                    {detalhesPacotes[m.motorista_id].em_rota.length > 5 && (
                                                        <p className="text-xs text-slate-500 px-3">
                                                            +{detalhesPacotes[m.motorista_id].em_rota.length - 5} em rota
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {detalhesPacotes[m.motorista_id].entregues.length > 0 && (
                                            <div>
                                                <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: '#00e676' }}>
                                                    ✅ Entregues
                                                </p>
                                                <div className="flex flex-col gap-1">
                                                    {detalhesPacotes[m.motorista_id].entregues.slice(0, 3).map(b => (
                                                        <p key={b} className="text-sm font-mono px-3 py-1 rounded"
                                                            style={{ backgroundColor: '#0d2b1a', color: '#00e676' }}>{b}</p>
                                                    ))}
                                                    {detalhesPacotes[m.motorista_id].entregues.length > 3 && (
                                                        <p className="text-xs text-slate-500 px-3">
                                                            +{detalhesPacotes[m.motorista_id].entregues.length - 3} entregues
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </main>
    )
}