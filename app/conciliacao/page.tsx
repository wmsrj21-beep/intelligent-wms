'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'

type ResultadoMotorista = {
    motorista_id: string
    motorista_nome: string
    placa: string
    entregues: string[]
    insucessos: string[]
    em_rota: string[]
    sem_info: string[]
}

const STATUS_ENTREGUE = ['Delivered']
const STATUS_INSUCESSO = ['Marked For Reprocess', 'Marked for problem', 'Marked For Problem']
const STATUS_EM_ROTA = ['In Transit']
const STATUS_BASE = ['Received', 'Inducted', 'Induct', 'Stowed']

export default function ConciliacaoPage() {
    const router = useRouter()
    const supabase = createClient()

    const [companyId, setCompanyId] = useState('')
    const [arquivo, setArquivo] = useState<Record<string, string>>({})
    const [arquivoNome, setArquivoNome] = useState('')
    const [processando, setProcessando] = useState(false)
    const [resultado, setResultado] = useState<ResultadoMotorista[]>([])
    const [fase, setFase] = useState<'upload' | 'resultado'>('upload')
    const [expandido, setExpandido] = useState<string | null>(null)

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            const { data: userData } = await supabase
                .from('users').select('company_id').eq('id', user.id).single()
            if (userData) setCompanyId(userData.company_id)
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
            setArquivo(resultado)
        }
        reader.readAsText(file, 'utf-8')
    }

    async function processar() {
        if (Object.keys(arquivo).length === 0) {
            alert('Suba o arquivo primeiro')
            return
        }
        setProcessando(true)

        const hoje = new Date()
        hoje.setHours(0, 0, 0, 0)

        // Busca todos os pacotes expedidos hoje
        const { data: eventos } = await supabase
            .from('package_events')
            .select(`
        driver_id, driver_name,
        packages(id, barcode, status),
        drivers(name, license_plate)
      `)
            .eq('company_id', companyId)
            .eq('event_type', 'dispatched')
            .gte('created_at', hoje.toISOString())

        if (!eventos || eventos.length === 0) {
            alert('Nenhum pacote expedido hoje encontrado')
            setProcessando(false)
            return
        }

        // Agrupa por motorista
        const agrupado: Record<string, ResultadoMotorista> = {}

        for (const ev of eventos) {
            const driverId = ev.driver_id
            if (!driverId) continue
            const barcode = (ev.packages as any)?.barcode
            if (!barcode) continue

            if (!agrupado[driverId]) {
                agrupado[driverId] = {
                    motorista_id: driverId,
                    motorista_nome: ev.driver_name || (ev.drivers as any)?.name || '-',
                    placa: (ev.drivers as any)?.license_plate || '-',
                    entregues: [],
                    insucessos: [],
                    em_rota: [],
                    sem_info: []
                }
            }

            const statusAmazon = arquivo[barcode]

            if (!statusAmazon) {
                agrupado[driverId].sem_info.push(barcode)
            } else if (STATUS_ENTREGUE.includes(statusAmazon)) {
                agrupado[driverId].entregues.push(barcode)
            } else if (STATUS_INSUCESSO.some(s => statusAmazon.includes(s) || s.includes(statusAmazon))) {
                agrupado[driverId].insucessos.push(barcode)
            } else if (STATUS_EM_ROTA.includes(statusAmazon)) {
                agrupado[driverId].em_rota.push(barcode)
            } else {
                agrupado[driverId].sem_info.push(barcode)
            }
        }

        // Atualiza status no banco
        for (const [driverId, res] of Object.entries(agrupado)) {
            // Marca entregues
            for (const barcode of res.entregues) {
                const { data: pkg } = await supabase
                    .from('packages').select('id').eq('barcode', barcode).eq('company_id', companyId).single()
                if (pkg) {
                    await supabase.from('packages').update({ status: 'delivered' }).eq('id', pkg.id)
                    await supabase.from('package_events').insert({
                        package_id: pkg.id,
                        company_id: companyId,
                        event_type: 'delivered',
                        outcome: 'delivered',
                        driver_id: driverId,
                        driver_name: res.motorista_nome
                    })
                }
            }

            // Marca insucessos
            for (const barcode of res.insucessos) {
                const { data: pkg } = await supabase
                    .from('packages').select('id').eq('barcode', barcode).eq('company_id', companyId).single()
                if (pkg) {
                    await supabase.from('packages').update({ status: 'unsuccessful' }).eq('id', pkg.id)
                    await supabase.from('package_events').insert({
                        package_id: pkg.id,
                        company_id: companyId,
                        event_type: 'unsuccessful',
                        outcome: 'unsuccessful',
                        driver_id: driverId,
                        driver_name: res.motorista_nome
                    })
                }
            }
        }

        setResultado(Object.values(agrupado))
        setProcessando(false)
        setFase('resultado')
    }

    function exportarRelatorio() {
        const wb = XLSX.utils.book_new()
        for (const r of resultado) {
            const rows = [
                ...r.entregues.map(b => ({ Codigo: b, Status: 'Entregue', Motorista: r.motorista_nome })),
                ...r.insucessos.map(b => ({ Codigo: b, Status: 'Insucesso', Motorista: r.motorista_nome })),
                ...r.em_rota.map(b => ({ Codigo: b, Status: 'Em Rota', Motorista: r.motorista_nome })),
                ...r.sem_info.map(b => ({ Codigo: b, Status: 'Sem Info', Motorista: r.motorista_nome })),
            ]
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows),
                r.motorista_nome.substring(0, 31))
        }
        XLSX.writeFile(wb, `conciliacao_${new Date().toISOString().slice(0, 10)}.xlsx`)
    }

    // ─── UPLOAD ───
    if (fase === 'upload') return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-lg mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-8">
                    🔄 Conciliação de Rua
                </h1>

                <div className="rounded-lg p-6 flex flex-col gap-6" style={{ backgroundColor: '#1a2736' }}>
                    <div>
                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-1">
                            Como funciona
                        </p>
                        <p className="text-slate-400 text-sm leading-relaxed">
                            Exporte o arquivo do Cortex com todos os pacotes do dia e suba aqui.
                            O sistema vai cruzar com os pacotes expedidos e atualizar os status automaticamente.
                        </p>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                            Arquivo do Cortex (CSV)
                        </label>
                        <label className="flex items-center justify-center gap-3 px-4 py-4 rounded cursor-pointer"
                            style={{ backgroundColor: '#0f1923', border: '2px dashed #2a3f52', color: '#00b4b4' }}>
                            <span className="text-sm font-bold tracking-widest uppercase">
                                {arquivoNome || '📁 Escolher arquivo CSV'}
                            </span>
                            <input type="file" accept=".csv" onChange={handleUpload} className="hidden" />
                        </label>
                        {arquivoNome && (
                            <p className="text-xs" style={{ color: '#00b4b4' }}>
                                ✅ {Object.keys(arquivo).length} pacotes carregados
                            </p>
                        )}
                    </div>

                    <button onClick={processar} disabled={processando || Object.keys(arquivo).length === 0}
                        className="py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                        style={{ backgroundColor: '#00b4b4' }}>
                        {processando ? 'Processando...' : 'Processar Conciliação'}
                    </button>
                </div>
            </div>
        </main>
    )

    // ─── RESULTADO ───
    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-6">
                    🔄 Resultado da Conciliação
                </h1>

                {/* Totais gerais */}
                <div className="grid grid-cols-4 gap-3 mb-6">
                    <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#0d2b1a', border: '1px solid #00e676' }}>
                        <p className="text-2xl font-black" style={{ color: '#00e676' }}>
                            {resultado.reduce((a, r) => a + r.entregues.length, 0)}
                        </p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00e676' }}>Entregues</p>
                    </div>
                    <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#2b0d0d', border: '1px solid #ff5252' }}>
                        <p className="text-2xl font-black" style={{ color: '#ff5252' }}>
                            {resultado.reduce((a, r) => a + r.insucessos.length, 0)}
                        </p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#ff5252' }}>Insucessos</p>
                    </div>
                    <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#1a2736', border: '1px solid #00b4b4' }}>
                        <p className="text-2xl font-black" style={{ color: '#00b4b4' }}>
                            {resultado.reduce((a, r) => a + r.em_rota.length, 0)}
                        </p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00b4b4' }}>Em Rota</p>
                    </div>
                    <div className="rounded-lg p-3 text-center" style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        <p className="text-2xl font-black text-slate-400">
                            {resultado.reduce((a, r) => a + r.sem_info.length, 0)}
                        </p>
                        <p className="text-xs font-bold tracking-widest uppercase mt-1 text-slate-500">Sem Info</p>
                    </div>
                </div>

                {/* Por motorista */}
                <div className="flex flex-col gap-3 mb-6">
                    {resultado.map(r => (
                        <div key={r.motorista_id} className="rounded-lg overflow-hidden"
                            style={{ backgroundColor: '#1a2736' }}>
                            <button
                                onClick={() => setExpandido(expandido === r.motorista_id ? null : r.motorista_id)}
                                className="w-full p-4 flex items-center justify-between">
                                <div className="text-left">
                                    <p className="text-white font-bold">{r.motorista_nome}</p>
                                    <p className="text-slate-400 text-xs">{r.placa}</p>
                                </div>
                                <div className="flex gap-3 text-xs font-bold">
                                    <span style={{ color: '#00e676' }}>✅ {r.entregues.length}</span>
                                    <span style={{ color: '#ff5252' }}>❌ {r.insucessos.length}</span>
                                    <span style={{ color: '#00b4b4' }}>🚚 {r.em_rota.length}</span>
                                    <span className="text-slate-500">⚪ {r.sem_info.length}</span>
                                    <span className="text-slate-400 ml-2">{expandido === r.motorista_id ? '▲' : '▼'}</span>
                                </div>
                            </button>

                            {expandido === r.motorista_id && (
                                <div className="px-4 pb-4 flex flex-col gap-3">
                                    {r.insucessos.length > 0 && (
                                        <div>
                                            <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: '#ff5252' }}>
                                                Insucessos — precisam voltar
                                            </p>
                                            <div className="flex flex-col gap-1">
                                                {r.insucessos.map(b => (
                                                    <p key={b} className="text-sm font-mono px-3 py-1 rounded"
                                                        style={{ backgroundColor: '#2b0d0d', color: '#ff5252' }}>{b}</p>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {r.entregues.length > 0 && (
                                        <div>
                                            <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: '#00e676' }}>
                                                Entregues
                                            </p>
                                            <div className="flex flex-col gap-1">
                                                {r.entregues.slice(0, 5).map(b => (
                                                    <p key={b} className="text-sm font-mono px-3 py-1 rounded"
                                                        style={{ backgroundColor: '#0d2b1a', color: '#00e676' }}>{b}</p>
                                                ))}
                                                {r.entregues.length > 5 && (
                                                    <p className="text-xs text-slate-500 px-3">
                                                        +{r.entregues.length - 5} entregues
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