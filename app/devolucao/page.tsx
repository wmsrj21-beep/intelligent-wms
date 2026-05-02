'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'

type PacoteDevolucao = {
    id: string
    barcode: string
    client_id: string
    client_name: string
    motivo: 'ausente_3x' | 'recusado'
    tentativas: number
    status: string
}

type GrupoDevolucao = {
    client_id: string
    client_name: string
    pacotes: PacoteDevolucao[]
}

type HistoricoItem = {
    id: string
    client_name: string
    total_pacotes: number
    operator_name: string
    enviado_at: string
    pacotes: { barcode: string; motivo: string }[]
}

type Base = {
    id: string
    name: string
    code: string | null
}

function hojeFormatado(): string {
    return new Date().toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).split('/').reverse().join('-')
}

function toISOStart(data: string): string {
    return `${data}T03:00:00.000Z`
}

function toISOEnd(data: string): string {
    const [ano, mes, dia] = data.split('-').map(Number)
    return new Date(Date.UTC(ano, mes - 1, dia + 1, 2, 59, 59, 999)).toISOString()
}

export default function DevolucaoPage() {
    const router = useRouter()
    const supabase = createClient()

    const [companyId, setCompanyId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [operatorName, setOperatorName] = useState('')
    const [isSuperAdmin, setIsSuperAdmin] = useState(false)
    const [bases, setBases] = useState<Base[]>([])
    const [baseSelecionada, setBaseSelecionada] = useState('')
    const [baseName, setBaseName] = useState('')

    const [aba, setAba] = useState<'elegiveis' | 'historico'>('elegiveis')
    const [grupos, setGrupos] = useState<GrupoDevolucao[]>([])
    const [loading, setLoading] = useState(true)
    const [processando, setProcessando] = useState(false)
    const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
    const [expandido, setExpandido] = useState<string | null>(null)
    const [sucesso, setSucesso] = useState('')

    // Histórico
    const [historico, setHistorico] = useState<HistoricoItem[]>([])
    const [loadingHistorico, setLoadingHistorico] = useState(false)
    const [dataHistorico, setDataHistorico] = useState(hojeFormatado())
    const [historicoSelecionado, setHistoricoSelecionado] = useState<HistoricoItem | null>(null)

    useEffect(() => {
        async function init() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/login'); return }
            setOperatorId(user.id)

            const { data: userData } = await supabase
                .from('users').select('company_id, name, cargo').eq('id', user.id).single()
            if (!userData) return
            setCompanyId(userData.company_id)
            setOperatorName(userData.name)

            const isSA = userData.cargo === 'super_admin' || userData.cargo === 'admin'
            setIsSuperAdmin(isSA)

            if (isSA) {
                const { data: basesData } = await supabase
                    .from('companies').select('id, name, code').eq('active', true).order('name')
                setBases(basesData || [])
                // Super admin começa sem base — mostra tudo
                setBaseSelecionada(userData.company_id)
                const base = basesData?.find((b: any) => b.id === userData.company_id)
                if (base) setBaseName(base.code ? `${base.code} — ${base.name}` : base.name)
                await carregarElegiveis(userData.company_id)
            } else {
                const { data: basesData } = await supabase
                    .from('user_bases')
                    .select('company_id, companies(id, name, code)')
                    .eq('user_id', user.id)

                const basesDoUser = basesData?.map((ub: any) => ub.companies).filter(Boolean) || []
                if (basesDoUser.length === 0) {
                    const { data: companyData } = await supabase
                        .from('companies').select('id, name, code').eq('id', userData.company_id).single()
                    if (companyData) {
                        setBases([companyData])
                        setBaseSelecionada(companyData.id)
                        setBaseName(companyData.code ? `${companyData.code} — ${companyData.name}` : companyData.name)
                        await carregarElegiveis(companyData.id)
                    }
                } else {
                    setBases(basesDoUser)
                    const primeira = basesDoUser[0]
                    setBaseSelecionada(primeira.id)
                    setBaseName(primeira.code ? `${primeira.code} — ${primeira.name}` : primeira.name)
                    await carregarElegiveis(primeira.id)
                }
            }
        }
        init()
    }, [])

    async function handleBaseChange(baseId: string) {
        setBaseSelecionada(baseId)
        const base = bases.find(b => b.id === baseId)
        setBaseName(base ? (base.code ? `${base.code} — ${base.name}` : base.name) : '')
        setSelecionados(new Set())
        await carregarElegiveis(baseId)
        if (aba === 'historico') await carregarHistorico(baseId, dataHistorico)
    }

    async function carregarElegiveis(cid: string) {
        setLoading(true)

        const { data: pkgsUnsuccessful } = await supabase
            .from('packages')
            .select('id, barcode, tentativas, clients(id, name)')
            .eq('company_id', cid)
            .eq('status', 'unsuccessful')

        const { data: incidentesRecusado } = await supabase
            .from('incidents')
            .select('package_id, packages(id, barcode, status, tentativas, clients(id, name))')
            .eq('company_id', cid)
            .eq('type', 'cliente_recusou')
            .eq('status', 'aberto')

        const elegiveis: PacoteDevolucao[] = []

        for (const pkg of (pkgsUnsuccessful || [])) {
            const tent = pkg.tentativas || 0
            if (tent >= 3) {
                elegiveis.push({
                    id: pkg.id,
                    barcode: pkg.barcode,
                    client_id: (pkg.clients as any)?.id || '',
                    client_name: (pkg.clients as any)?.name || '-',
                    motivo: 'ausente_3x',
                    tentativas: tent,
                    status: 'unsuccessful'
                })
            }
        }

        for (const inc of (incidentesRecusado || [])) {
            const pkg = (inc.packages as any)
            if (!pkg || pkg.status === 'devolvido_cliente') continue
            const jaAdicionado = elegiveis.find(e => e.id === pkg.id)
            if (!jaAdicionado) {
                elegiveis.push({
                    id: pkg.id,
                    barcode: pkg.barcode,
                    client_id: pkg.clients?.id || '',
                    client_name: pkg.clients?.name || '-',
                    motivo: 'recusado',
                    tentativas: pkg.tentativas || 0,
                    status: pkg.status
                })
            }
        }

        const agrupado: Record<string, GrupoDevolucao> = {}
        for (const pkg of elegiveis) {
            if (!agrupado[pkg.client_id]) {
                agrupado[pkg.client_id] = {
                    client_id: pkg.client_id,
                    client_name: pkg.client_name,
                    pacotes: []
                }
            }
            agrupado[pkg.client_id].pacotes.push(pkg)
        }

        setGrupos(Object.values(agrupado))
        setLoading(false)
    }

    async function carregarHistorico(cid: string, data: string) {
        setLoadingHistorico(true)
        const inicio = toISOStart(data)
        const fim = toISOEnd(data)

        const { data: devs } = await supabase
            .from('devolucoes')
            .select('id, client_name, total_pacotes, operator_name, enviado_at')
            .eq('company_id', cid)
            .gte('enviado_at', inicio)
            .lte('enviado_at', fim)
            .order('enviado_at', { ascending: false })

        if (!devs || devs.length === 0) {
            setHistorico([])
            setLoadingHistorico(false)
            return
        }

        const resultado: HistoricoItem[] = []
        for (const dev of devs) {
            const { data: items } = await supabase
                .from('devolucao_items')
                .select('barcode, motivo')
                .eq('devolucao_id', dev.id)

            resultado.push({
                id: dev.id,
                client_name: dev.client_name,
                total_pacotes: dev.total_pacotes,
                operator_name: dev.operator_name,
                enviado_at: dev.enviado_at,
                pacotes: items || []
            })
        }

        setHistorico(resultado)
        setLoadingHistorico(false)
    }

    function handleAbaChange(novaAba: 'elegiveis' | 'historico') {
        setAba(novaAba)
        if (novaAba === 'historico' && baseSelecionada) {
            carregarHistorico(baseSelecionada, dataHistorico)
        }
    }

    function handleDataHistoricoChange(e: React.ChangeEvent<HTMLInputElement>) {
        setDataHistorico(e.target.value)
        if (baseSelecionada) carregarHistorico(baseSelecionada, e.target.value)
    }

    function toggleSelecionado(id: string) {
        setSelecionados(prev => {
            const novo = new Set(prev)
            if (novo.has(id)) novo.delete(id)
            else novo.add(id)
            return novo
        })
    }

    function selecionarTodosDoCliente(clientId: string) {
        const grupo = grupos.find(g => g.client_id === clientId)
        if (!grupo) return
        const todosIds = grupo.pacotes.map(p => p.id)
        const todosSelecionados = todosIds.every(id => selecionados.has(id))
        setSelecionados(prev => {
            const novo = new Set(prev)
            if (todosSelecionados) todosIds.forEach(id => novo.delete(id))
            else todosIds.forEach(id => novo.add(id))
            return novo
        })
    }

    async function confirmarDevolucao() {
        if (selecionados.size === 0) return
        const confirmar = window.confirm(
            `Confirma a devolução de ${selecionados.size} pacote(s) ao cliente?\n\nEsta ação é irreversível.`
        )
        if (!confirmar) return

        setProcessando(true)
        const totalSelecionados = selecionados.size

        const porCliente: Record<string, { client_id: string; client_name: string; pacotes: PacoteDevolucao[] }> = {}
        for (const grupo of grupos) {
            for (const pkg of grupo.pacotes) {
                if (!selecionados.has(pkg.id)) continue
                if (!porCliente[grupo.client_id]) {
                    porCliente[grupo.client_id] = {
                        client_id: grupo.client_id,
                        client_name: grupo.client_name,
                        pacotes: []
                    }
                }
                porCliente[grupo.client_id].pacotes.push(pkg)
            }
        }

        for (const [clientId, dados] of Object.entries(porCliente)) {
            const { data: dev } = await supabase.from('devolucoes').insert({
                company_id: baseSelecionada,
                client_id: clientId || null,
                client_name: dados.client_name,
                operator_id: operatorId,
                operator_name: operatorName,
                status: 'enviado',
                total_pacotes: dados.pacotes.length,
                enviado_at: new Date().toISOString()
            }).select().single()

            if (!dev) continue

            for (const pkg of dados.pacotes) {
                await supabase.from('devolucao_items').insert({
                    devolucao_id: dev.id,
                    package_id: pkg.id,
                    barcode: pkg.barcode,
                    motivo: pkg.motivo
                })
                await supabase.from('packages')
                    .update({ status: 'devolvido_cliente' })
                    .eq('id', pkg.id)
                await supabase.from('package_events').insert({
                    package_id: pkg.id,
                    company_id: baseSelecionada,
                    event_type: 'devolucao_cliente',
                    operator_id: operatorId,
                    operator_name: operatorName,
                    outcome_notes: `Devolvido a ${dados.client_name}`
                })
            }

            imprimirRomaneio(dados.client_name, dados.pacotes)
        }

        setSelecionados(new Set())
        setProcessando(false)
        setSucesso(`${totalSelecionados} pacote(s) marcados como devolvidos ao cliente.`)
        setTimeout(() => setSucesso(''), 4000)
        await carregarElegiveis(baseSelecionada)
    }

    function imprimirRomaneio(clientName: string, pacotes: PacoteDevolucao[]) {
        const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        const conteudo = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Romaneio de Devolução</title>
<style>
  body{font-family:Arial,sans-serif;padding:40px;max-width:700px;margin:0 auto;color:#000}
  h1{font-size:18px;text-align:center;margin-bottom:4px}
  h2{font-size:14px;text-align:center;color:#555;margin-bottom:24px}
  .info{border:1px solid #ccc;padding:12px;margin-bottom:20px;border-radius:4px}
  .info p{margin:4px 0;font-size:13px}
  .info strong{display:inline-block;width:140px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  th{background:#f0f0f0;padding:8px;text-align:left;font-size:12px;border:1px solid #ccc}
  td{padding:7px 8px;font-size:12px;border:1px solid #ccc}
  .ausente{color:#cc6600}.recusado{color:#cc0000}
  .assinaturas{display:flex;gap:40px;margin-top:60px}
  .assinatura{flex:1;text-align:center}
  .assinatura .linha{border-top:1px solid #000;margin-bottom:6px}
  .assinatura p{font-size:12px;margin:2px 0}
  .rodape{margin-top:30px;font-size:11px;color:#666;text-align:center}
  @media print{body{padding:20px}}
</style></head><body>
<h1>Intelligent WMS</h1>
<h2>Romaneio de Devolução ao Embarcador</h2>
<div class="info">
  <p><strong>Base:</strong> ${baseName}</p>
  <p><strong>Data/Hora:</strong> ${dataHora}</p>
  <p><strong>Cliente / Embarcador:</strong> ${clientName}</p>
  <p><strong>Total de Pacotes:</strong> ${pacotes.length}</p>
  <p><strong>Responsável:</strong> ${operatorName}</p>
</div>
<table><thead><tr><th>#</th><th>Código do Pacote</th><th>Motivo da Devolução</th><th>Tentativas</th></tr></thead>
<tbody>${pacotes.map((p, i) => `<tr><td>${i + 1}</td><td><strong>${p.barcode}</strong></td>
<td class="${p.motivo === 'recusado' ? 'recusado' : 'ausente'}">${p.motivo === 'ausente_3x' ? '🔄 Ausente — 3 tentativas' : '🚫 Recusado pelo destinatário'}</td>
<td>${p.tentativas}x</td></tr>`).join('')}</tbody></table>
<p style="font-size:12px;margin-bottom:40px">Total de pacotes devolvidos: <strong>${pacotes.length}</strong></p>
<div class="assinaturas">
  <div class="assinatura"><div class="linha"></div><p><strong>${operatorName}</strong></p><p>Responsável pela Devolução</p><p>${baseName}</p></div>
  <div class="assinatura"><div class="linha"></div><p><strong>${clientName}</strong></p><p>Representante do Embarcador</p><p>Recebido em: ${dataHora}</p></div>
</div>
<div class="rodape">Documento gerado automaticamente pelo Intelligent WMS em ${dataHora}</div>
</body></html>`

        const janela = window.open('', '_blank')
        if (janela) {
            janela.document.write(conteudo)
            janela.document.close()
            janela.focus()
            setTimeout(() => janela.print(), 500)
        }
    }

    function reimprimirRomaneio(item: HistoricoItem) {
        const dataHora = new Date(item.enviado_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        const conteudo = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Romaneio de Devolução</title>
<style>
  body{font-family:Arial,sans-serif;padding:40px;max-width:700px;margin:0 auto;color:#000}
  h1{font-size:18px;text-align:center;margin-bottom:4px}
  h2{font-size:14px;text-align:center;color:#555;margin-bottom:24px}
  .info{border:1px solid #ccc;padding:12px;margin-bottom:20px;border-radius:4px}
  .info p{margin:4px 0;font-size:13px}
  .info strong{display:inline-block;width:140px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  th{background:#f0f0f0;padding:8px;text-align:left;font-size:12px;border:1px solid #ccc}
  td{padding:7px 8px;font-size:12px;border:1px solid #ccc}
  .ausente{color:#cc6600}.recusado{color:#cc0000}
  .rodape{margin-top:30px;font-size:11px;color:#666;text-align:center}
  @media print{body{padding:20px}}
</style></head><body>
<h1>Intelligent WMS</h1>
<h2>Romaneio de Devolução ao Embarcador — 2ª Via</h2>
<div class="info">
  <p><strong>Base:</strong> ${baseName}</p>
  <p><strong>Data/Hora:</strong> ${dataHora}</p>
  <p><strong>Cliente / Embarcador:</strong> ${item.client_name}</p>
  <p><strong>Total de Pacotes:</strong> ${item.total_pacotes}</p>
  <p><strong>Responsável:</strong> ${item.operator_name}</p>
</div>
<table><thead><tr><th>#</th><th>Código do Pacote</th><th>Motivo da Devolução</th></tr></thead>
<tbody>${item.pacotes.map((p, i) => `<tr><td>${i + 1}</td><td><strong>${p.barcode}</strong></td>
<td class="${p.motivo === 'recusado' ? 'recusado' : 'ausente'}">${p.motivo === 'ausente_3x' ? '🔄 Ausente — 3 tentativas' : '🚫 Recusado pelo destinatário'}</td></tr>`).join('')}</tbody></table>
<div class="rodape">Documento gerado automaticamente pelo Intelligent WMS em ${dataHora}</div>
</body></html>`

        const janela = window.open('', '_blank')
        if (janela) {
            janela.document.write(conteudo)
            janela.document.close()
            janela.focus()
            setTimeout(() => janela.print(), 500)
        }
    }

    function exportarExcel() {
        const rows: any[] = []
        for (const grupo of grupos) {
            for (const pkg of grupo.pacotes) {
                if (!selecionados.has(pkg.id)) continue
                rows.push({
                    'Código': pkg.barcode,
                    'Cliente': pkg.client_name,
                    'Motivo': pkg.motivo === 'ausente_3x' ? 'Ausente 3x' : 'Recusado',
                    'Tentativas': pkg.tentativas,
                })
            }
        }
        if (rows.length === 0) return
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Devolução')
        XLSX.writeFile(wb, `devolucao_${new Date().toISOString().slice(0, 10)}.xlsx`)
    }

    const totalElegiveis = grupos.reduce((a, g) => a + g.pacotes.length, 0)

    // ─── TELA DETALHE HISTÓRICO ───
    if (historicoSelecionado) {
        return (
            <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
                <div className="max-w-2xl mx-auto">
                    <button onClick={() => setHistoricoSelecionado(null)}
                        className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                    <h1 className="text-white font-black tracking-widest uppercase text-xl mb-1">
                        📦 Devolução — {historicoSelecionado.client_name}
                    </h1>
                    <p className="text-slate-400 text-xs mb-6">
                        {new Date(historicoSelecionado.enviado_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                        {' · '}por {historicoSelecionado.operator_name}
                    </p>

                    <div className="grid grid-cols-2 gap-3 mb-6">
                        <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#0d2b1a', border: '1px solid #00e676' }}>
                            <p className="text-2xl font-black" style={{ color: '#00e676' }}>{historicoSelecionado.total_pacotes}</p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: '#00e676' }}>Pacotes Devolvidos</p>
                        </div>
                        <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                            <p className="text-xl font-black text-white">{historicoSelecionado.client_name}</p>
                            <p className="text-xs font-bold tracking-widest uppercase mt-1 text-slate-400">Embarcador</p>
                        </div>
                    </div>

                    <div className="rounded-lg p-5 mb-6" style={{ backgroundColor: '#1a2736' }}>
                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                            Pacotes — {historicoSelecionado.pacotes.length}
                        </p>
                        <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                            {historicoSelecionado.pacotes.map((p, i) => (
                                <div key={i} className="flex items-center justify-between p-3 rounded"
                                    style={{ backgroundColor: '#0f1923' }}>
                                    <p className="text-white font-mono text-sm">{p.barcode}</p>
                                    <span className="text-xs font-bold px-2 py-1 rounded"
                                        style={{
                                            backgroundColor: p.motivo === 'recusado' ? '#2b0d0d' : '#2b1f0d',
                                            color: p.motivo === 'recusado' ? '#ff5252' : '#ffb300'
                                        }}>
                                        {p.motivo === 'ausente_3x' ? '🔄 Ausente 3x' : '🚫 Recusado'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <button onClick={() => reimprimirRomaneio(historicoSelecionado)}
                        className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#00b4b4' }}>
                        🖨️ Reimprimir Romaneio
                    </button>
                </div>
            </main>
        )
    }

    // ─── TELA PRINCIPAL ───
    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-3xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-white font-black tracking-widest uppercase text-xl">
                            📦 Devolução ao Embarcador
                        </h1>
                        <p className="text-slate-400 text-xs mt-1">{baseName}</p>
                    </div>
                    {aba === 'elegiveis' && selecionados.size > 0 && (
                        <div className="flex gap-2">
                            <button onClick={exportarExcel}
                                className="px-4 py-2 rounded font-black tracking-widest uppercase text-sm"
                                style={{ backgroundColor: '#1a2736', color: '#00b4b4', border: '1px solid #00b4b4' }}>
                                ⬇️ Excel
                            </button>
                            <button onClick={confirmarDevolucao} disabled={processando}
                                className="px-4 py-2 rounded font-black tracking-widest uppercase text-sm disabled:opacity-50"
                                style={{ backgroundColor: '#c0392b', color: 'white' }}>
                                {processando ? 'Processando...' : `Devolver (${selecionados.size})`}
                            </button>
                        </div>
                    )}
                </div>

                {/* Seletor de base */}
                {(isSuperAdmin || bases.length > 1) && (
                    <div className="flex items-center gap-3 px-4 py-2 rounded-lg mb-4"
                        style={{ backgroundColor: '#1a2736' }}>
                        <span className="text-xs font-bold tracking-widest uppercase text-slate-400">Base</span>
                        <select value={baseSelecionada} onChange={e => handleBaseChange(e.target.value)}
                            className="text-white text-sm outline-none flex-1"
                            style={{ backgroundColor: 'transparent' }}>
                            {bases.map(b => (
                                <option key={b.id} value={b.id}>
                                    {b.code ? `${b.code} — ` : ''}{b.name}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Abas */}
                <div className="flex gap-2 mb-6">
                    <button onClick={() => handleAbaChange('elegiveis')}
                        className="px-5 py-2 rounded font-black tracking-widest uppercase text-sm outline-none"
                        style={{
                            backgroundColor: aba === 'elegiveis' ? '#00b4b4' : '#1a2736',
                            color: 'white'
                        }}>
                        Elegíveis ({totalElegiveis})
                    </button>
                    <button onClick={() => handleAbaChange('historico')}
                        className="px-5 py-2 rounded font-black tracking-widest uppercase text-sm outline-none"
                        style={{
                            backgroundColor: aba === 'historico' ? '#00b4b4' : '#1a2736',
                            color: 'white'
                        }}>
                        Histórico
                    </button>
                </div>

                {sucesso && (
                    <div className="rounded p-3 mb-4 text-sm font-bold"
                        style={{ backgroundColor: '#0d2b1a', color: '#00e676', border: '1px solid #00e676' }}>
                        ✅ {sucesso}
                    </div>
                )}

                {/* ─── ABA ELEGÍVEIS ─── */}
                {aba === 'elegiveis' && (
                    loading ? (
                        <p className="text-slate-400 text-sm">Carregando...</p>
                    ) : totalElegiveis === 0 ? (
                        <div className="rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                            <p className="text-2xl mb-2">✅</p>
                            <p className="text-white font-bold">Nenhum pacote elegível para devolução</p>
                            <p className="text-slate-400 text-sm mt-1">
                                Aparecem aqui pacotes com 3+ tentativas ou marcados como recusados
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {grupos.map(grupo => {
                                const todosSelecionados = grupo.pacotes.every(p => selecionados.has(p.id))
                                const algunsSelecionados = grupo.pacotes.some(p => selecionados.has(p.id))
                                return (
                                    <div key={grupo.client_id} className="rounded-lg overflow-hidden"
                                        style={{ backgroundColor: '#1a2736' }}>
                                        <div className="flex items-center justify-between p-4">
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={() => selecionarTodosDoCliente(grupo.client_id)}
                                                    className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold outline-none"
                                                    style={{
                                                        backgroundColor: todosSelecionados ? '#00b4b4' : algunsSelecionados ? '#2a3f52' : '#0f1923',
                                                        border: `2px solid ${todosSelecionados ? '#00b4b4' : '#2a3f52'}`
                                                    }}>
                                                    {todosSelecionados ? '✓' : algunsSelecionados ? '−' : ''}
                                                </button>
                                                <div>
                                                    <p className="text-white font-bold">{grupo.client_name}</p>
                                                    <p className="text-slate-400 text-xs">
                                                        {grupo.pacotes.length} pacote{grupo.pacotes.length !== 1 ? 's' : ''} elegíveis
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setExpandido(expandido === grupo.client_id ? null : grupo.client_id)}
                                                className="px-3 py-1 rounded text-xs font-bold outline-none"
                                                style={{ backgroundColor: '#0f1923', color: '#94a3b8', border: '1px solid #2a3f52' }}>
                                                {expandido === grupo.client_id ? '▲' : '▼'}
                                            </button>
                                        </div>
                                        {expandido === grupo.client_id && (
                                            <div className="border-t px-4 pb-4" style={{ borderColor: '#0f1923' }}>
                                                <div className="flex flex-col gap-2 mt-3">
                                                    {grupo.pacotes.map(pkg => (
                                                        <div key={pkg.id}
                                                            onClick={() => toggleSelecionado(pkg.id)}
                                                            className="flex items-center justify-between p-3 rounded cursor-pointer"
                                                            style={{
                                                                backgroundColor: selecionados.has(pkg.id) ? '#0d1f2b' : '#0f1923',
                                                                border: selecionados.has(pkg.id) ? '1px solid #00b4b4' : '1px solid transparent'
                                                            }}>
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-5 h-5 rounded flex items-center justify-center text-xs"
                                                                    style={{
                                                                        backgroundColor: selecionados.has(pkg.id) ? '#00b4b4' : '#1a2736',
                                                                        border: `2px solid ${selecionados.has(pkg.id) ? '#00b4b4' : '#2a3f52'}`
                                                                    }}>
                                                                    {selecionados.has(pkg.id) && '✓'}
                                                                </div>
                                                                <div>
                                                                    <p className="text-white font-mono text-sm">{pkg.barcode}</p>
                                                                    <p className="text-xs mt-0.5"
                                                                        style={{ color: pkg.motivo === 'recusado' ? '#ff5252' : '#ffb300' }}>
                                                                        {pkg.motivo === 'ausente_3x'
                                                                            ? `🔄 Ausente — ${pkg.tentativas} tentativas`
                                                                            : '🚫 Recusado pelo destinatário'}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )
                )}

                {/* ─── ABA HISTÓRICO ─── */}
                {aba === 'historico' && (
                    <div>
                        <div className="flex items-center gap-3 mb-4 px-4 py-2 rounded-lg"
                            style={{ backgroundColor: '#1a2736' }}>
                            <span className="text-xs font-bold tracking-widest uppercase text-slate-400">Data</span>
                            <input type="date" value={dataHistorico}
                                onChange={handleDataHistoricoChange}
                                max={hojeFormatado()}
                                className="text-white text-sm outline-none flex-1"
                                style={{ backgroundColor: 'transparent', colorScheme: 'dark' }} />
                            {dataHistorico !== hojeFormatado() && (
                                <button onClick={() => {
                                    setDataHistorico(hojeFormatado())
                                    if (baseSelecionada) carregarHistorico(baseSelecionada, hojeFormatado())
                                }}
                                    className="px-3 py-1 rounded text-xs font-bold tracking-widest uppercase"
                                    style={{ backgroundColor: '#00b4b4', color: 'white' }}>
                                    Hoje
                                </button>
                            )}
                        </div>

                        {loadingHistorico ? (
                            <p className="text-slate-400 text-sm">Carregando...</p>
                        ) : historico.length === 0 ? (
                            <div className="rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                                <p className="text-slate-400">Nenhuma devolução registrada nesta data</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3">
                                {historico.map(item => (
                                    <button key={item.id}
                                        onClick={() => setHistoricoSelecionado(item)}
                                        className="rounded-lg p-4 text-left hover:opacity-90 outline-none"
                                        style={{ backgroundColor: '#1a2736', border: '1px solid #1a2736' }}>
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-white font-bold">
                                                    Devolvido a {item.client_name}
                                                </p>
                                                <p className="text-slate-400 text-xs mt-1">
                                                    {new Date(item.enviado_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                                                    {' · '}por {item.operator_name}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-2xl font-black" style={{ color: '#00e676' }}>
                                                    {item.total_pacotes}
                                                </p>
                                                <p className="text-xs text-slate-400">pacotes</p>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </main>
    )
}