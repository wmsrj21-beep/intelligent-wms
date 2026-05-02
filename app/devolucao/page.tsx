'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import { somSucesso, somErro, somAlerta } from '../lib/sounds'

type HistoricoItem = {
    id: string
    client_name: string
    total_pacotes: number
    operator_name: string
    enviado_at: string
    codigo_viagem: string
    motorista_nome: string
    motorista_placa: string
    pacotes: { barcode: string; motivo: string }[]
}

type Base = {
    id: string
    name: string
    code: string | null
}

type Cliente = {
    id: string
    name: string
}

type ViagemAtiva = {
    id: string
    codigo_viagem: string
    motorista_nome: string
    motorista_placa: string
    client_id: string
    client_name: string
    bipados: {
        id: string
        barcode: string
        client_name: string
        motivo: 'ausente_3x' | 'recusado' | 'incidente'
        tentativas: number
        incidente_tipo?: string
    }[]
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

const tipoIncidenteLabel: Record<string, string> = {
    avaria: '💥 Avaria',
    extravio: '❓ Extravio',
    roubo: '🚨 Roubo',
    lost: '💀 Lost',
    endereco_errado: '📍 End. Errado',
    cliente_recusou: '🚫 Recusado',
    outros: '📝 Outros'
}

export default function DevolucaoPage() {
    const router = useRouter()
    const supabase = createClient()
    const inputRef = useRef<HTMLInputElement>(null)

    const [companyId, setCompanyId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [operatorName, setOperatorName] = useState('')
    const [isSuperAdmin, setIsSuperAdmin] = useState(false)
    const [bases, setBases] = useState<Base[]>([])
    const [baseSelecionada, setBaseSelecionada] = useState('')
    const [baseName, setBaseName] = useState('')
    const [clientes, setClientes] = useState<Cliente[]>([])

    const [aba, setAba] = useState<'nova' | 'historico'>('nova')
    const [historico, setHistorico] = useState<HistoricoItem[]>([])
    const [loadingHistorico, setLoadingHistorico] = useState(false)
    const [dataHistorico, setDataHistorico] = useState(hojeFormatado())
    const [historicoSelecionado, setHistoricoSelecionado] = useState<HistoricoItem | null>(null)

    const [modalNovaViagem, setModalNovaViagem] = useState(false)
    const [formCodigo, setFormCodigo] = useState('')
    const [formMotorista, setFormMotorista] = useState('')
    const [formPlaca, setFormPlaca] = useState('')
    const [formClienteId, setFormClienteId] = useState('')
    const [formErro, setFormErro] = useState('')

    const [viagem, setViagem] = useState<ViagemAtiva | null>(null)
    const [barcode, setBarcode] = useState('')
    const [feedback, setFeedback] = useState<{ msg: string; tipo: 'ok' | 'erro' | 'alerta' } | null>(null)
    const [finalizando, setFinalizando] = useState(false)
    const [resultado, setResultado] = useState<ViagemAtiva | null>(null)

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
                setBaseSelecionada(userData.company_id)
                const base = basesData?.find((b: any) => b.id === userData.company_id)
                if (base) {
                    setBaseName(base.code ? `${base.code} — ${base.name}` : base.name)
                    await carregarClientes(userData.company_id)
                }
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
                        await carregarClientes(companyData.id)
                    }
                } else {
                    setBases(basesDoUser)
                    const primeira = basesDoUser[0]
                    setBaseSelecionada(primeira.id)
                    setBaseName(primeira.code ? `${primeira.code} — ${primeira.name}` : primeira.name)
                    await carregarClientes(primeira.id)
                }
            }
        }
        init()
    }, [])

    async function carregarClientes(cid: string) {
        const { data } = await supabase
            .from('clients').select('id, name')
            .eq('company_id', cid).eq('active', true).order('name')
        setClientes(data || [])
        setFormClienteId('')
    }

    async function handleBaseChange(baseId: string) {
        setBaseSelecionada(baseId)
        const base = bases.find(b => b.id === baseId)
        setBaseName(base ? (base.code ? `${base.code} — ${base.name}` : base.name) : '')
        await carregarClientes(baseId)
        if (aba === 'historico') await carregarHistorico(baseId, dataHistorico)
    }

    async function carregarHistorico(cid: string, data: string) {
        setLoadingHistorico(true)
        const inicio = toISOStart(data)
        const fim = toISOEnd(data)

        const { data: devs } = await supabase
            .from('devolucoes')
            .select('id, client_name, total_pacotes, operator_name, enviado_at, codigo_viagem, motorista_nome, motorista_placa')
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
                .from('devolucao_items').select('barcode, motivo').eq('devolucao_id', dev.id)
            resultado.push({ ...dev, pacotes: items || [] })
        }
        setHistorico(resultado)
        setLoadingHistorico(false)
    }

    function handleAbaChange(novaAba: 'nova' | 'historico') {
        setAba(novaAba)
        if (novaAba === 'historico' && baseSelecionada) {
            carregarHistorico(baseSelecionada, dataHistorico)
        }
    }

    function abrirModalNovaViagem() {
        setFormCodigo('')
        setFormMotorista('')
        setFormPlaca('')
        setFormClienteId('')
        setFormErro('')
        setModalNovaViagem(true)
    }

    function iniciarViagem() {
        if (!formCodigo.trim()) { setFormErro('Informe o código da viagem'); return }
        if (!formClienteId) { setFormErro('Selecione o cliente / embarcador'); return }
        if (!formMotorista.trim()) { setFormErro('Informe o nome do motorista'); return }
        if (!formPlaca.trim()) { setFormErro('Informe a placa'); return }

        const clienteSelecionado = clientes.find(c => c.id === formClienteId)
        setViagem({
            id: '',
            codigo_viagem: formCodigo.trim().toUpperCase(),
            motorista_nome: formMotorista.trim(),
            motorista_placa: formPlaca.trim().toUpperCase(),
            client_id: formClienteId,
            client_name: clienteSelecionado?.name || '',
            bipados: []
        })
        setModalNovaViagem(false)
        setBarcode('')
        setTimeout(() => inputRef.current?.focus(), 200)
    }

    async function handleBipe(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key !== 'Enter') return
        const codigo = barcode.trim()
        if (!codigo || !viagem) return
        setBarcode('')

        if (viagem.bipados.find(b => b.barcode === codigo)) {
            somAlerta()
            setFeedback({ msg: `⚠️ ${codigo} já foi bipado nesta viagem`, tipo: 'alerta' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        const { data: pkgs } = await supabase
            .from('packages')
            .select('id, barcode, status, tentativas, clients(id, name)')
            .eq('barcode', codigo)
            .eq('company_id', baseSelecionada)
            .limit(1)

        const pkg = pkgs?.[0]

        if (!pkg) {
            somErro()
            setFeedback({ msg: `❌ ${codigo} — pacote não encontrado nesta base`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        if (['lost', 'devolvido_cliente', 'delivered'].includes(pkg.status)) {
            somErro()
            setFeedback({ msg: `❌ ${codigo} — status finalizado, não pode ser devolvido`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 2000)
            inputRef.current?.focus()
            return
        }

        // Verificar cliente
        const pkgClientId = (pkg.clients as any)?.id
        if (pkgClientId && pkgClientId !== viagem.client_id) {
            somErro()
            const pkgClientName = (pkg.clients as any)?.name || '-'
            setFeedback({ msg: `❌ ${codigo} — pertence a ${pkgClientName}, não a ${viagem.client_name}`, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 3000)
            inputRef.current?.focus()
            return
        }

        const tent = pkg.tentativas || 0
        let motivo: 'ausente_3x' | 'recusado' | 'incidente' | null = null
        let incidente_tipo: string | undefined = undefined

        // 1. 3+ tentativas unsuccessful
        if (tent >= 3 && pkg.status === 'unsuccessful') {
            motivo = 'ausente_3x'
        } else {
            // 2. Qualquer incidente aberto ou em análise
            const { data: inc } = await supabase
                .from('incidents')
                .select('id, type')
                .eq('package_id', pkg.id)
                .in('status', ['aberto', 'em_analise'])
                .limit(1)

            if (inc && inc.length > 0) {
                incidente_tipo = inc[0].type
                motivo = inc[0].type === 'cliente_recusou' ? 'recusado' : 'incidente'
            }
        }

        if (!motivo) {
            somErro()
            const msg = tent > 0
                ? `❌ ${codigo} — ${tent} tentativa(s), precisa de 3 para devolver`
                : `❌ ${codigo} — não elegível (sem incidente aberto ou 3+ tentativas)`
            setFeedback({ msg, tipo: 'erro' })
            setTimeout(() => setFeedback(null), 3000)
            inputRef.current?.focus()
            return
        }

        const clientName = (pkg.clients as any)?.name || viagem.client_name
        somSucesso()

        const motivoLabel = motivo === 'ausente_3x'
            ? `Ausente ${tent}x`
            : motivo === 'recusado'
                ? 'Recusado'
                : tipoIncidenteLabel[incidente_tipo || ''] || 'Incidente'

        setViagem(prev => prev ? {
            ...prev,
            bipados: [...prev.bipados, {
                id: pkg.id,
                barcode: codigo,
                client_name: clientName,
                motivo,
                tentativas: tent,
                incidente_tipo
            }]
        } : prev)

        setFeedback({ msg: `✅ ${codigo} — ${motivoLabel}`, tipo: 'ok' })
        setTimeout(() => setFeedback(null), 1500)
        inputRef.current?.focus()
    }

    async function finalizarViagem() {
        if (!viagem || viagem.bipados.length === 0) return
        const confirmar = window.confirm(
            `Finalizar viagem ${viagem.codigo_viagem} com ${viagem.bipados.length} pacote(s)?\n\nEsta ação é irreversível.`
        )
        if (!confirmar) return

        setFinalizando(true)

        const { data: dev } = await supabase.from('devolucoes').insert({
            company_id: baseSelecionada,
            client_id: viagem.client_id || null,
            client_name: viagem.client_name,
            operator_id: operatorId,
            operator_name: operatorName,
            status: 'enviado',
            total_pacotes: viagem.bipados.length,
            enviado_at: new Date().toISOString(),
            codigo_viagem: viagem.codigo_viagem,
            motorista_nome: viagem.motorista_nome,
            motorista_placa: viagem.motorista_placa
        }).select().single()

        if (dev) {
            for (const pkg of viagem.bipados) {
                // Mapeia motivo para o campo da tabela
                const motivoDb = pkg.motivo === 'ausente_3x' ? 'ausente_3x'
                    : pkg.motivo === 'recusado' ? 'recusado'
                        : 'incidente'

                await supabase.from('devolucao_items').insert({
                    devolucao_id: dev.id,
                    package_id: pkg.id,
                    barcode: pkg.barcode,
                    motivo: motivoDb
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
                    outcome_notes: `Devolvido a ${viagem.client_name} — Viagem ${viagem.codigo_viagem}`
                })
                // Marcar incidente como devolvido
                if (pkg.motivo === 'recusado' || pkg.motivo === 'incidente') {
                    await supabase.from('incidents')
                        .update({ status: 'devolvido' })
                        .eq('package_id', pkg.id)
                        .in('status', ['aberto', 'em_analise'])
                }
            }
        }

        setResultado(viagem)
        setViagem(null)
        setFinalizando(false)
        imprimirRomaneio(viagem)
    }

    function getMotivoLabel(motivo: string, incidente_tipo?: string, tentativas?: number): string {
        if (motivo === 'ausente_3x') return `🔄 Ausente — ${tentativas}x`
        if (motivo === 'recusado') return '🚫 Recusado'
        if (motivo === 'incidente' && incidente_tipo) return tipoIncidenteLabel[incidente_tipo] || '🚨 Incidente'
        return '🚨 Incidente'
    }

    function imprimirRomaneio(v: ViagemAtiva) {
        const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        const conteudo = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Romaneio de Devolução</title>
<style>
  body{font-family:Arial,sans-serif;padding:40px;max-width:700px;margin:0 auto;color:#000}
  h1{font-size:18px;text-align:center;margin-bottom:4px}
  h2{font-size:14px;text-align:center;color:#555;margin-bottom:24px}
  .info{border:1px solid #ccc;padding:12px;margin-bottom:20px;border-radius:4px}
  .info p{margin:4px 0;font-size:13px}
  .info strong{display:inline-block;width:160px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  th{background:#f0f0f0;padding:8px;text-align:left;font-size:12px;border:1px solid #ccc}
  td{padding:7px 8px;font-size:12px;border:1px solid #ccc}
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
  <p><strong>Código da Viagem:</strong> ${v.codigo_viagem}</p>
  <p><strong>Cliente / Embarcador:</strong> ${v.client_name}</p>
  <p><strong>Data/Hora:</strong> ${dataHora}</p>
  <p><strong>Motorista:</strong> ${v.motorista_nome}</p>
  <p><strong>Placa:</strong> ${v.motorista_placa}</p>
  <p><strong>Total de Pacotes:</strong> ${v.bipados.length}</p>
  <p><strong>Responsável:</strong> ${operatorName}</p>
</div>
<table><thead><tr><th>#</th><th>Código do Pacote</th><th>Motivo</th><th>Tentativas</th></tr></thead>
<tbody>${v.bipados.map((p, i) => `<tr>
  <td>${i + 1}</td>
  <td><strong>${p.barcode}</strong></td>
  <td>${getMotivoLabel(p.motivo, p.incidente_tipo, p.tentativas)}</td>
  <td>${p.tentativas > 0 ? p.tentativas + 'x' : '-'}</td>
</tr>`).join('')}</tbody></table>
<p style="font-size:12px;margin-bottom:40px">Total: <strong>${v.bipados.length}</strong> pacote(s)</p>
<div class="assinaturas">
  <div class="assinatura"><div class="linha"></div><p><strong>${operatorName}</strong></p><p>Responsável pela Devolução</p><p>${baseName}</p></div>
  <div class="assinatura"><div class="linha"></div><p><strong>${v.motorista_nome}</strong></p><p>Motorista — ${v.motorista_placa}</p><p>Recebido em: ${dataHora}</p></div>
</div>
<div class="rodape">Documento gerado automaticamente pelo Intelligent WMS em ${dataHora} — Viagem ${v.codigo_viagem}</div>
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
  .info strong{display:inline-block;width:160px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  th{background:#f0f0f0;padding:8px;text-align:left;font-size:12px;border:1px solid #ccc}
  td{padding:7px 8px;font-size:12px;border:1px solid #ccc}
  .rodape{margin-top:30px;font-size:11px;color:#666;text-align:center}
  @media print{body{padding:20px}}
</style></head><body>
<h1>Intelligent WMS</h1>
<h2>Romaneio de Devolução ao Embarcador — 2ª Via</h2>
<div class="info">
  <p><strong>Base:</strong> ${baseName}</p>
  <p><strong>Código da Viagem:</strong> ${item.codigo_viagem || '-'}</p>
  <p><strong>Cliente / Embarcador:</strong> ${item.client_name}</p>
  <p><strong>Data/Hora:</strong> ${dataHora}</p>
  <p><strong>Motorista:</strong> ${item.motorista_nome || '-'}</p>
  <p><strong>Placa:</strong> ${item.motorista_placa || '-'}</p>
  <p><strong>Total de Pacotes:</strong> ${item.total_pacotes}</p>
  <p><strong>Responsável:</strong> ${item.operator_name}</p>
</div>
<table><thead><tr><th>#</th><th>Código do Pacote</th><th>Motivo</th></tr></thead>
<tbody>${item.pacotes.map((p, i) => `<tr>
  <td>${i + 1}</td><td><strong>${p.barcode}</strong></td>
  <td>${p.motivo === 'ausente_3x' ? '🔄 Ausente — 3x' : p.motivo === 'recusado' ? '🚫 Recusado' : '🚨 Incidente'}</td>
</tr>`).join('')}</tbody></table>
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

    // ─── TELA RESULTADO ───
    if (resultado) return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-lg mx-auto">
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-1">✅ Viagem Finalizada</h1>
                <p className="text-slate-400 text-xs mb-6">Romaneio impresso automaticamente</p>
                <div className="rounded-lg p-5 mb-4 flex flex-col gap-3" style={{ backgroundColor: '#1a2736' }}>
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Código da Viagem</span>
                        <span className="text-white font-bold">{resultado.codigo_viagem}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Cliente / Embarcador</span>
                        <span className="text-white font-bold">{resultado.client_name}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Motorista</span>
                        <span className="text-white font-bold">{resultado.motorista_nome}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Placa</span>
                        <span className="text-white font-bold">{resultado.motorista_placa}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Pacotes Devolvidos</span>
                        <span className="font-black text-2xl" style={{ color: '#00e676' }}>{resultado.bipados.length}</span>
                    </div>
                </div>
                <div className="flex flex-col gap-3">
                    <button onClick={() => imprimirRomaneio(resultado)}
                        className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#00b4b4' }}>
                        🖨️ Reimprimir Romaneio
                    </button>
                    <button onClick={() => setResultado(null)}
                        className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        Nova Viagem
                    </button>
                    <button onClick={() => router.push('/dashboard')}
                        className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#1a2736', border: '1px solid #2a3f52' }}>
                        Dashboard
                    </button>
                </div>
            </div>
        </main>
    )

    // ─── TELA BIPAGEM ───
    if (viagem) return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <h1 className="text-white font-black tracking-widest uppercase text-xl">
                            📤 Viagem {viagem.codigo_viagem}
                        </h1>
                        <p className="text-xs mt-0.5" style={{ color: '#00b4b4' }}>{viagem.client_name}</p>
                        <p className="text-slate-400 text-xs mt-0.5">{viagem.motorista_nome} · {viagem.motorista_placa}</p>
                        <p className="text-xs mt-0.5 text-slate-500">📍 {baseName}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-3xl font-black" style={{ color: '#00e676' }}>{viagem.bipados.length}</p>
                        <p className="text-xs text-slate-400">bipados</p>
                    </div>
                </div>

                <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                    <input ref={inputRef} type="text" value={barcode}
                        onChange={e => setBarcode(e.target.value)}
                        onKeyDown={handleBipe}
                        placeholder="Bipe ou digite o código e pressione Enter"
                        className="w-full px-4 py-4 rounded text-white text-lg outline-none"
                        style={{ backgroundColor: '#0f1923', border: '2px solid #00b4b4' }}
                        autoFocus />
                </div>

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

                {viagem.bipados.length > 0 && (
                    <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#1a2736' }}>
                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                            Pacotes na Viagem — {viagem.bipados.length}
                        </p>
                        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                            {[...viagem.bipados].reverse().map((b, i) => (
                                <div key={i} className="flex items-center justify-between p-3 rounded"
                                    style={{ backgroundColor: '#0f1923' }}>
                                    <p className="text-white font-mono text-sm">{b.barcode}</p>
                                    <span className="text-xs font-bold px-2 py-1 rounded"
                                        style={{
                                            backgroundColor: b.motivo === 'recusado' ? '#2b0d0d' : b.motivo === 'incidente' ? '#1a1a2b' : '#2b1f0d',
                                            color: b.motivo === 'recusado' ? '#ff5252' : b.motivo === 'incidente' ? '#00b4b4' : '#ffb300'
                                        }}>
                                        {getMotivoLabel(b.motivo, b.incidente_tipo, b.tentativas)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <button onClick={finalizarViagem} disabled={finalizando || viagem.bipados.length === 0}
                    className="w-full py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                    style={{ backgroundColor: viagem.bipados.length > 0 ? '#c0392b' : '#1a2736' }}>
                    {finalizando ? 'Finalizando...' : `Finalizar Viagem (${viagem.bipados.length} pacotes)`}
                </button>
            </div>
        </main>
    )

    // ─── TELA DETALHE HISTÓRICO ───
    if (historicoSelecionado) return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-2xl mx-auto">
                <button onClick={() => setHistoricoSelecionado(null)}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>
                <h1 className="text-white font-black tracking-widest uppercase text-xl mb-1">
                    📦 Viagem {historicoSelecionado.codigo_viagem || '-'}
                </h1>
                <p className="text-slate-400 text-xs mb-6">
                    {new Date(historicoSelecionado.enviado_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                    {' · '}por {historicoSelecionado.operator_name}
                </p>
                <div className="rounded-lg p-4 mb-6 flex flex-col gap-3" style={{ backgroundColor: '#1a2736' }}>
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Cliente / Embarcador</span>
                        <span className="text-white font-bold">{historicoSelecionado.client_name}</span>
                    </div>
                    {historicoSelecionado.motorista_nome && (
                        <div className="flex justify-between">
                            <span className="text-slate-400 text-sm">Motorista</span>
                            <span className="text-white font-bold">{historicoSelecionado.motorista_nome}</span>
                        </div>
                    )}
                    {historicoSelecionado.motorista_placa && (
                        <div className="flex justify-between">
                            <span className="text-slate-400 text-sm">Placa</span>
                            <span className="text-white font-bold">{historicoSelecionado.motorista_placa}</span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Total de Pacotes</span>
                        <span className="font-black text-2xl" style={{ color: '#00e676' }}>{historicoSelecionado.total_pacotes}</span>
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
                                    {p.motivo === 'ausente_3x' ? '🔄 Ausente 3x' : p.motivo === 'recusado' ? '🚫 Recusado' : '🚨 Incidente'}
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

    // ─── TELA PRINCIPAL ───
    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-3xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-white font-black tracking-widest uppercase text-xl">
                            📤 Devolução ao Embarcador
                        </h1>
                        <p className="text-slate-400 text-xs mt-1">{baseName}</p>
                    </div>
                    <button onClick={abrirModalNovaViagem}
                        className="px-4 py-2 rounded font-black tracking-widest uppercase text-white text-sm"
                        style={{ backgroundColor: '#00b4b4' }}>
                        + Nova Viagem
                    </button>
                </div>

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

                <div className="flex gap-2 mb-6">
                    <button onClick={() => handleAbaChange('nova')}
                        className="px-5 py-2 rounded font-black tracking-widest uppercase text-sm outline-none"
                        style={{ backgroundColor: aba === 'nova' ? '#00b4b4' : '#1a2736', color: 'white' }}>
                        Início
                    </button>
                    <button onClick={() => handleAbaChange('historico')}
                        className="px-5 py-2 rounded font-black tracking-widest uppercase text-sm outline-none"
                        style={{ backgroundColor: aba === 'historico' ? '#00b4b4' : '#1a2736', color: 'white' }}>
                        Histórico
                    </button>
                </div>

                {aba === 'nova' && (
                    <div className="rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                        <p className="text-4xl mb-4">📤</p>
                        <p className="text-white font-bold text-lg mb-2">Iniciar uma Nova Viagem de Devolução</p>
                        <p className="text-slate-400 text-sm mb-6">
                            Clique em "+ Nova Viagem" para criar um código de viagem, selecionar o cliente, informar o motorista e começar a bipar os pacotes elegíveis.
                        </p>
                        <div className="flex flex-col gap-2 text-xs text-slate-500 text-left max-w-xs mx-auto">
                            <p>✅ Elegíveis: pacotes com 3+ tentativas</p>
                            <p>✅ Elegíveis: pacotes com incidente aberto (qualquer tipo)</p>
                            <p>❌ Não elegíveis: pacotes sem incidente ou menos de 3 tentativas</p>
                        </div>
                    </div>
                )}

                {aba === 'historico' && (
                    <div>
                        <div className="flex items-center gap-3 mb-4 px-4 py-2 rounded-lg"
                            style={{ backgroundColor: '#1a2736' }}>
                            <span className="text-xs font-bold tracking-widest uppercase text-slate-400">Data</span>
                            <input type="date" value={dataHistorico}
                                onChange={e => {
                                    setDataHistorico(e.target.value)
                                    if (baseSelecionada) carregarHistorico(baseSelecionada, e.target.value)
                                }}
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
                                        style={{ backgroundColor: '#1a2736' }}>
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-white font-bold">Viagem {item.codigo_viagem || '-'}</p>
                                                <p className="text-xs mt-0.5" style={{ color: '#00b4b4' }}>{item.client_name}</p>
                                                <p className="text-slate-400 text-xs mt-0.5">
                                                    {item.motorista_nome || '-'} · {item.motorista_placa || '-'}
                                                </p>
                                                <p className="text-slate-500 text-xs mt-0.5">
                                                    {new Date(item.enviado_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                                                    {' · '}por {item.operator_name}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-2xl font-black" style={{ color: '#00e676' }}>{item.total_pacotes}</p>
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

            {/* ─── Modal Nova Viagem ─── */}
            {modalNovaViagem && (
                <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
                    <div className="w-full max-w-md rounded-lg p-6 flex flex-col gap-4"
                        style={{ backgroundColor: '#1a2736' }}>
                        <div className="flex justify-between items-center">
                            <h2 className="text-white font-black tracking-widest uppercase">📤 Nova Viagem</h2>
                            <button onClick={() => setModalNovaViagem(false)}
                                className="text-slate-400 hover:text-white">✕</button>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Código da Viagem *</label>
                            <input value={formCodigo}
                                onChange={e => setFormCodigo(e.target.value.toUpperCase())}
                                placeholder="Ex: DEV-001, RET-2026-05"
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}
                                autoFocus />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Cliente / Embarcador *</label>
                            <select value={formClienteId} onChange={e => setFormClienteId(e.target.value)}
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                <option value="">Selecione o cliente</option>
                                {clientes.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Nome do Motorista *</label>
                            <input value={formMotorista}
                                onChange={e => setFormMotorista(e.target.value)}
                                placeholder="Nome completo"
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Placa do Veículo *</label>
                            <input value={formPlaca}
                                onChange={e => setFormPlaca(e.target.value.toUpperCase())}
                                placeholder="ABC-1234"
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                        </div>
                        {formErro && <p className="text-xs font-bold" style={{ color: '#ff5252' }}>❌ {formErro}</p>}
                        <button onClick={iniciarViagem}
                            className="py-3 rounded font-black tracking-widest uppercase text-white text-sm"
                            style={{ backgroundColor: '#00b4b4' }}>
                            Iniciar Bipagem →
                        </button>
                    </div>
                </div>
            )}
        </main>
    )
}