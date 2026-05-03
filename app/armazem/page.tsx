'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'

type Pacote = {
    id: string
    barcode: string
    status: string
    created_at: string
    clients: { name: string } | null
    diasParado: number
}

type Incidente = {
    id: string
    barcode: string
    type: string
    description: string | null
    status: string
    operator_name: string | null
    created_at: string
    package_status?: string
}

type Base = {
    id: string
    name: string
    code: string | null
}

const tipoIncidente: Record<string, string> = {
    avaria: '💥 Avaria',
    extravio: '❓ Extravio',
    roubo: '🚨 Roubo',
    lost: '💀 Lost',
    endereco_errado: '📍 Endereço Errado',
    cliente_recusou: '🚫 Cliente Recusou',
    outros: '📝 Outros'
}

const TIPOS_FINALIZADORES = ['roubo', 'lost']

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

function fmtDate(dt: string) {
    return new Date(dt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

export default function ArmazemPage() {
    const router = useRouter()
    const supabase = createClient()
    const bipeRef = useRef<HTMLInputElement>(null)

    const [companyId, setCompanyId] = useState('')
    const [operatorId, setOperatorId] = useState('')
    const [operatorName, setOperatorName] = useState('')
    const [isSuperAdmin, setIsSuperAdmin] = useState(false)
    const [bases, setBases] = useState<Base[]>([])
    const [baseSelecionada, setBaseSelecionada] = useState('')
    const [aba, setAba] = useState<'estoque' | 'parados' | 'incidentes' | 'extravio' | 'relatorios'>('estoque')

    const [estoque, setEstoque] = useState<Pacote[]>([])
    const [parados, setParados] = useState<Pacote[]>([])
    const [paradosMotorista, setParadosMotorista] = useState<Pacote[]>([])
    const [incidentes, setIncidentes] = useState<Incidente[]>([])
    const [extravios, setExtravios] = useState<Pacote[]>([])
    const [loading, setLoading] = useState(true)

    const [modalIncidente, setModalIncidente] = useState(false)
    const [pacoteSelecionado, setPacoteSelecionado] = useState<Pacote | null>(null)
    const [tipoInc, setTipoInc] = useState('avaria')
    const [descInc, setDescInc] = useState('')
    const [salvandoInc, setSalvandoInc] = useState(false)

    const [modalBipe, setModalBipe] = useState(false)
    const [bipeBarcode, setBipeBarcode] = useState('')
    const [bipePacote, setBipePacote] = useState<Pacote | null>(null)
    const [bipeErro, setBipeErro] = useState('')
    const [bipeTipo, setBipeTipo] = useState('avaria')
    const [bipeDesc, setBipeDesc] = useState('')
    const [bipeSalvando, setBipeSalvando] = useState(false)
    const [bipeBuscando, setBipeBuscando] = useState(false)

    // Relatórios
    const [relDataInicio, setRelDataInicio] = useState(hojeFormatado())
    const [relDataFim, setRelDataFim] = useState(hojeFormatado())
    const [relBase, setRelBase] = useState('')
    const [relCarregando, setRelCarregando] = useState('')

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
                setRelBase('all')
                await carregarDados(null)
            } else {
                const { data: basesData } = await supabase
                    .from('user_bases')
                    .select('company_id, companies(id, name, code)')
                    .eq('user_id', user.id)

                const basesDoUser = basesData?.map((ub: any) => ub.companies).filter(Boolean) || []
                if (basesDoUser.length === 0) {
                    setBases([{ id: userData.company_id, name: 'Minha Base', code: null }])
                    setBaseSelecionada(userData.company_id)
                    setRelBase(userData.company_id)
                    await carregarDados(userData.company_id)
                } else {
                    setBases(basesDoUser)
                    const primeiraBase = basesDoUser[0].id
                    setBaseSelecionada(primeiraBase)
                    setRelBase(primeiraBase)
                    await carregarDados(primeiraBase)
                }
            }
        }
        init()
    }, [])

    async function carregarDados(cid: string | null) {
        setLoading(true)

        const buildQuery = (table: string, extraFilters: (q: any) => any) => {
            let q = supabase.from(table).select('id, barcode, status, created_at, clients(name)')
            if (cid) q = q.eq('company_id', cid)
            return extraFilters(q)
        }

        const [pkgsRes, extraviosRes, incRes] = await Promise.all([
            buildQuery('packages', q => q.in('status', ['in_warehouse', 'unsuccessful', 'incident']).order('created_at', { ascending: true })),
            buildQuery('packages', q => q.eq('status', 'extravio').order('created_at', { ascending: true })),
            (() => {
                let q = supabase.from('incidents').select('*, packages(status)')
                if (cid) q = q.eq('company_id', cid)
                return q.order('created_at', { ascending: false })
            })()
        ])

        const agora = new Date()
        const pkgs = (pkgsRes.data || []).map((p: any) => ({
            ...p,
            diasParado: Math.floor((agora.getTime() - new Date(p.created_at).getTime()) / 86400000)
        }))

        const extraviosPkgs = (extraviosRes.data || []).map((p: any) => ({
            ...p,
            diasParado: Math.floor((agora.getTime() - new Date(p.created_at).getTime()) / 86400000)
        }))

        setEstoque(pkgs.filter((p: any) => p.status === 'in_warehouse'))
        setParados(pkgs.filter((p: any) => p.status === 'in_warehouse' && p.diasParado >= 3))
        setParadosMotorista(pkgs.filter((p: any) => p.status === 'unsuccessful'))
        setExtravios(extraviosPkgs)

        const incs = (incRes.data || [])
            .filter((i: any) => i.packages?.status !== 'lost')
            .map((i: any) => ({ ...i, package_status: i.packages?.status }))
        setIncidentes(incs)
        setLoading(false)
    }

    async function handleBaseChange(baseId: string) {
        setBaseSelecionada(baseId)
        await carregarDados(baseId === 'all' ? null : baseId)
    }

    function cidAtual() {
        return baseSelecionada && baseSelecionada !== 'all' ? baseSelecionada : companyId
    }

    function recarregar() {
        return carregarDados(baseSelecionada && baseSelecionada !== 'all' ? baseSelecionada : null)
    }

    async function abrirIncidente() {
        if (!pacoteSelecionado) return
        setSalvandoInc(true)

        const isFinalizador = TIPOS_FINALIZADORES.includes(tipoInc)
        const novoStatus = isFinalizador ? 'lost' : 'incident'

        await supabase.from('packages').update({ status: novoStatus }).eq('id', pacoteSelecionado.id)
        await supabase.from('package_events').insert({
            package_id: pacoteSelecionado.id, company_id: cidAtual(),
            event_type: isFinalizador ? 'lost' : 'incident',
            operator_id: operatorId, operator_name: operatorName,
            outcome_notes: isFinalizador ? `Baixa por incidente: ${tipoInc}` : null
        })
        await supabase.from('incidents').insert({
            company_id: cidAtual(), package_id: pacoteSelecionado.id,
            barcode: pacoteSelecionado.barcode, type: tipoInc,
            description: descInc || null, operator_id: operatorId,
            operator_name: operatorName, status: isFinalizador ? 'resolvido' : 'aberto'
        })

        setSalvandoInc(false)
        setModalIncidente(false)
        setPacoteSelecionado(null)
        setTipoInc('avaria')
        setDescInc('')
        await recarregar()
    }

    async function handleBipeBusca(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key !== 'Enter') return
        const codigo = bipeBarcode.trim()
        if (!codigo) return

        setBipeBuscando(true)
        setBipeErro('')
        setBipePacote(null)

        const cid = cidAtual()
        const { data: pkgs } = await supabase
            .from('packages')
            .select('id, barcode, status, created_at, clients(name)')
            .eq('barcode', codigo)
            .eq('company_id', cid)
            .in('status', ['in_warehouse', 'unsuccessful', 'incident'])
            .limit(1)

        const pkg = pkgs?.[0]
        if (!pkg) {
            setBipeErro('Pacote não encontrado nesta base ou não está no armazém')
            setBipeBuscando(false)
            return
        }

        const diasParado = Math.floor((Date.now() - new Date(pkg.created_at).getTime()) / 86400000)
        setBipePacote({ ...pkg, diasParado, clients: pkg.clients?.[0] ?? null } as unknown as Pacote)
        setBipeBuscando(false)
    }

    async function confirmarIncidenteBipe() {
        if (!bipePacote) return
        setBipeSalvando(true)

        const isFinalizador = TIPOS_FINALIZADORES.includes(bipeTipo)
        const novoStatus = isFinalizador ? 'lost' : 'incident'

        await supabase.from('packages').update({ status: novoStatus }).eq('id', bipePacote.id)
        await supabase.from('package_events').insert({
            package_id: bipePacote.id, company_id: cidAtual(),
            event_type: isFinalizador ? 'lost' : 'incident',
            operator_id: operatorId, operator_name: operatorName,
            outcome_notes: isFinalizador ? `Baixa por incidente: ${bipeTipo}` : null
        })
        await supabase.from('incidents').insert({
            company_id: cidAtual(), package_id: bipePacote.id,
            barcode: bipePacote.barcode, type: bipeTipo,
            description: bipeDesc || null, operator_id: operatorId,
            operator_name: operatorName, status: isFinalizador ? 'resolvido' : 'aberto'
        })

        setBipeSalvando(false)
        setModalBipe(false)
        setBipeBarcode('')
        setBipePacote(null)
        setBipeErro('')
        setBipeTipo('avaria')
        setBipeDesc('')
        await recarregar()
    }

    function abrirModalBipe() {
        setBipeBarcode('')
        setBipePacote(null)
        setBipeErro('')
        setBipeTipo('avaria')
        setBipeDesc('')
        setModalBipe(true)
        setTimeout(() => bipeRef.current?.focus(), 100)
    }

    async function marcarComoLost(pkg: Pacote) {
        const confirmar = window.confirm(`Confirma marcar ${pkg.barcode} como LOST (perda definitiva)?`)
        if (!confirmar) return

        await supabase.from('packages').update({ status: 'lost' }).eq('id', pkg.id)
        await supabase.from('package_events').insert({
            package_id: pkg.id, company_id: cidAtual(),
            event_type: 'lost', operator_id: operatorId, operator_name: operatorName,
            outcome_notes: 'Marcado como Lost após prazo de 6 dias em extravio'
        })
        await recarregar()
    }

    // ─── RELATÓRIOS ───
    function relCid() {
        return relBase && relBase !== 'all' ? relBase : null
    }

    async function gerarRelatorio(tipo: string) {
        if (!relDataInicio || !relDataFim) { alert('Selecione o período'); return }
        setRelCarregando(tipo)
        const inicio = toISOStart(relDataInicio)
        const fim = toISOEnd(relDataFim)
        const cid = relCid()
        const wb = XLSX.utils.book_new()

        try {
            if (tipo === 'entradas' || tipo === 'geral') {
                let q = supabase.from('package_events')
                    .select('created_at, operator_name, packages(barcode, clients(name)), companies(name, code)')
                    .eq('event_type', 'received')
                    .gte('created_at', inicio).lte('created_at', fim)
                    .order('created_at', { ascending: true })
                if (cid) q = q.eq('company_id', cid)
                const { data } = await q
                const rows = (data || []).map((e: any) => ({
                    'Data/Hora': fmtDate(e.created_at),
                    'Código': e.packages?.barcode || '-',
                    'Cliente': e.packages?.clients?.name || '-',
                    'Base': e.companies?.code ? `${e.companies.code} — ${e.companies.name}` : e.companies?.name || '-',
                    'Operador': e.operator_name || '-',
                }))
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Entradas')
            }

            if (tipo === 'saidas' || tipo === 'geral') {
                let q = supabase.from('package_events')
                    .select('created_at, operator_name, driver_name, packages(barcode, clients(name)), companies(name, code), drivers(license_plate)')
                    .eq('event_type', 'dispatched')
                    .gte('created_at', inicio).lte('created_at', fim)
                    .order('created_at', { ascending: true })
                if (cid) q = q.eq('company_id', cid)
                const { data } = await q
                const rows = (data || []).map((e: any) => ({
                    'Data/Hora': fmtDate(e.created_at),
                    'Código': e.packages?.barcode || '-',
                    'Cliente': e.packages?.clients?.name || '-',
                    'Base': e.companies?.code ? `${e.companies.code} — ${e.companies.name}` : e.companies?.name || '-',
                    'Motorista': e.driver_name || '-',
                    'Placa': e.drivers?.license_plate || '-',
                    'Operador': e.operator_name || '-',
                }))
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Saídas')
            }

            if (tipo === 'rua' || tipo === 'geral') {
                let q = supabase.from('package_events')
                    .select('created_at, event_type, driver_name, packages(barcode, clients(name), tentativas), companies(name, code)')
                    .in('event_type', ['delivered', 'unsuccessful'])
                    .gte('created_at', inicio).lte('created_at', fim)
                    .order('created_at', { ascending: true })
                if (cid) q = q.eq('company_id', cid)
                const { data } = await q
                const rows = (data || []).map((e: any) => ({
                    'Data/Hora': fmtDate(e.created_at),
                    'Código': e.packages?.barcode || '-',
                    'Cliente': e.packages?.clients?.name || '-',
                    'Base': e.companies?.code ? `${e.companies.code} — ${e.companies.name}` : e.companies?.name || '-',
                    'Motorista': e.driver_name || '-',
                    'Status': e.event_type === 'delivered' ? '✅ Entregue' : '❌ Insucesso',
                    'Tentativas': e.packages?.tentativas || 0,
                }))
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Rua')
            }

            if (tipo === 'incidentes' || tipo === 'geral') {
                let q = supabase.from('incidents')
                    .select('created_at, type, status, operator_name, barcode, description, packages(clients(name)), companies(name, code)')
                    .gte('created_at', inicio).lte('created_at', fim)
                    .order('created_at', { ascending: true })
                if (cid) q = q.eq('company_id', cid)
                const { data } = await q
                const rows = (data || []).map((e: any) => ({
                    'Data/Hora': fmtDate(e.created_at),
                    'Código': e.barcode || '-',
                    'Cliente': e.packages?.clients?.name || '-',
                    'Base': e.companies?.code ? `${e.companies.code} — ${e.companies.name}` : e.companies?.name || '-',
                    'Tipo': tipoIncidente[e.type] || e.type,
                    'Status': e.status,
                    'Descrição': e.description || '-',
                    'Operador': e.operator_name || '-',
                }))
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Incidentes')
            }

            if (tipo === 'retorno' || tipo === 'geral') {
                let q = supabase.from('package_events')
                    .select('created_at, operator_name, driver_name, packages(barcode, clients(name)), companies(name, code)')
                    .eq('event_type', 'returned')
                    .gte('created_at', inicio).lte('created_at', fim)
                    .order('created_at', { ascending: true })
                if (cid) q = q.eq('company_id', cid)
                const { data } = await q
                const rows = (data || []).map((e: any) => ({
                    'Data/Hora': fmtDate(e.created_at),
                    'Código': e.packages?.barcode || '-',
                    'Cliente': e.packages?.clients?.name || '-',
                    'Base': e.companies?.code ? `${e.companies.code} — ${e.companies.name}` : e.companies?.name || '-',
                    'Motorista': e.driver_name || '-',
                    'Operador': e.operator_name || '-',
                }))
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Retorno de Rua')
            }

            if (tipo === 'qlp' || tipo === 'geral') {
                let qDisp = supabase.from('package_events')
                    .select('driver_id, driver_name')
                    .eq('event_type', 'dispatched')
                    .gte('created_at', inicio).lte('created_at', fim)
                if (cid) qDisp = qDisp.eq('company_id', cid)
                const { data: dispData } = await qDisp

                let qDel = supabase.from('package_events')
                    .select('driver_id')
                    .eq('event_type', 'delivered')
                    .gte('created_at', inicio).lte('created_at', fim)
                if (cid) qDel = qDel.eq('company_id', cid)
                const { data: delData } = await qDel

                let qIns = supabase.from('package_events')
                    .select('driver_id')
                    .eq('event_type', 'unsuccessful')
                    .gte('created_at', inicio).lte('created_at', fim)
                if (cid) qIns = qIns.eq('company_id', cid)
                const { data: insData } = await qIns

                const motoristas: Record<string, { nome: string, total: number, entregues: number, insucessos: number }> = {}
                for (const e of dispData || []) {
                    if (!e.driver_id) continue
                    if (!motoristas[e.driver_id]) motoristas[e.driver_id] = { nome: e.driver_name || '-', total: 0, entregues: 0, insucessos: 0 }
                    motoristas[e.driver_id].total++
                }
                for (const e of delData || []) {
                    if (e.driver_id && motoristas[e.driver_id]) motoristas[e.driver_id].entregues++
                }
                for (const e of insData || []) {
                    if (e.driver_id && motoristas[e.driver_id]) motoristas[e.driver_id].insucessos++
                }

                const rows = Object.values(motoristas).map(m => ({
                    'Motorista': m.nome,
                    'Total Expedido': m.total,
                    'Entregues': m.entregues,
                    'Insucessos': m.insucessos,
                    'Taxa Entrega (%)': m.total > 0 ? Math.round((m.entregues / m.total) * 100) : 0,
                }))
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'QLP Motoristas')
            }

            if (tipo === 'devolucao' || tipo === 'geral') {
                let q = supabase.from('devolucoes')
                    .select('id, enviado_at, codigo_viagem, client_name, motorista_nome, motorista_placa, operator_name, total_pacotes, companies(name, code)')
                    .gte('enviado_at', inicio).lte('enviado_at', fim)
                    .order('enviado_at', { ascending: true })
                if (cid) q = q.eq('company_id', cid)
                const { data: devs } = await q

                const rows: any[] = []
                for (const dev of devs || []) {
                    const { data: items } = await supabase
                        .from('devolucao_items').select('barcode, motivo, incidente_tipo')
                        .eq('devolucao_id', dev.id)

                    for (const item of items || []) {
                        rows.push({
                            'Data/Hora': fmtDate(dev.enviado_at),
                            'Viagem': dev.codigo_viagem || '-',
                            'Base': (dev as any).companies?.code ? `${(dev as any).companies.code} — ${(dev as any).companies.name}` : (dev as any).companies?.name || '-',
                            'Cliente': dev.client_name || '-',
                            'Código Pacote': item.barcode,
                            'Motivo': item.motivo === 'ausente_3x' ? 'Ausente 3x' : item.motivo === 'recusado' ? 'Recusado' : item.incidente_tipo || 'Incidente',
                            'Motorista': dev.motorista_nome || '-',
                            'Placa': dev.motorista_placa || '-',
                            'Responsável': dev.operator_name || '-',
                        })
                    }
                }
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Devoluções')
            }

            if (wb.SheetNames.length === 0) {
                alert('Nenhum dado encontrado no período selecionado.')
                setRelCarregando('')
                return
            }

            const nomeArquivo = tipo === 'geral'
                ? `relatorio_geral_${relDataInicio}_${relDataFim}.xlsx`
                : `relatorio_${tipo}_${relDataInicio}_${relDataFim}.xlsx`

            XLSX.writeFile(wb, nomeArquivo)
        } catch (err) {
            alert('Erro ao gerar relatório.')
            console.error(err)
        }

        setRelCarregando('')
    }

    function corDias(dias: number) {
        if (dias >= 6) return '#ff5252'
        if (dias >= 3) return '#ffb300'
        return '#00e676'
    }

    function bgDias(dias: number) {
        if (dias >= 6) return '#2b0d0d'
        if (dias >= 3) return '#2b1f0d'
        return '#0d2b1a'
    }

    function diasExtravio(created_at: string) {
        return Math.floor((Date.now() - new Date(created_at).getTime()) / 86400000)
    }

    function diasIncidente(created_at: string) {
        return Math.floor((Date.now() - new Date(created_at).getTime()) / 86400000)
    }

    function statusIncidenteDisplay(inc: Incidente) {
        const pkg_status = inc.package_status
        const isFinalizador = TIPOS_FINALIZADORES.includes(inc.type)

        if (pkg_status === 'devolvido_cliente') return { label: '✅ Devolvido', color: '#00e676', bg: '#0d2b1a' }
        if (isFinalizador || pkg_status === 'lost') return { label: '💀 Baixa', color: '#94a3b8', bg: '#1a2736' }

        const dias = diasIncidente(inc.created_at)
        if (dias >= 6) return { label: `🔴 ${dias}d — crítico`, color: '#ff5252', bg: '#2b0d0d' }
        if (dias >= 3) return { label: `🟡 ${dias}d — atenção`, color: '#ffb300', bg: '#2b1f0d' }
        return { label: `🟢 ${dias}d`, color: '#00e676', bg: '#0d2b1a' }
    }

    const estoquePorCliente = estoque.reduce((acc: Record<string, { nome: string, total: number, criticos: number, alertas: number }>, p) => {
        const nome = (p.clients as any)?.name || 'Sem cliente'
        if (!acc[nome]) acc[nome] = { nome, total: 0, criticos: 0, alertas: 0 }
        acc[nome].total++
        if (p.diasParado >= 6) acc[nome].criticos++
        else if (p.diasParado >= 3) acc[nome].alertas++
        return acc
    }, {})

    const extraviosCriticos = extravios.filter(p => diasExtravio(p.created_at) >= 6)
    const incidentesAtivos = incidentes.filter(i =>
        i.package_status !== 'devolvido_cliente' && !TIPOS_FINALIZADORES.includes(i.type)
    )

    const relatorios = [
        { key: 'entradas', label: '📥 Entradas', desc: 'Pacotes recebidos no período' },
        { key: 'saidas', label: '🚚 Saídas', desc: 'Pacotes expedidos no período' },
        { key: 'rua', label: '🛣️ Rua', desc: 'Entregas e insucessos' },
        { key: 'incidentes', label: '🚨 Incidentes', desc: 'Lost, Roubo, Extravio, Avaria e outros' },
        { key: 'retorno', label: '↩️ Retorno de Rua', desc: 'Pacotes devolvidos pelos motoristas' },
        { key: 'qlp', label: '🚗 QLP Motoristas', desc: 'Taxa de entrega por motorista' },
        { key: 'devolucao', label: '📤 Devoluções', desc: 'Devoluções ao embarcador' },
        { key: 'geral', label: '📊 Geral', desc: 'Todos os relatórios compilados' },
    ]

    return (
        <main className="min-h-screen p-6" style={{ backgroundColor: '#0f1923' }}>
            <div className="max-w-3xl mx-auto">
                <button onClick={() => router.push('/dashboard')}
                    className="text-slate-400 text-sm mb-6 hover:text-white">← Voltar</button>

                <div className="flex items-center justify-between mb-4">
                    <h1 className="text-white font-black tracking-widest uppercase text-xl">🏭 Armazém</h1>
                    <button onClick={abrirModalBipe}
                        className="px-4 py-2 rounded font-black tracking-widest uppercase text-white text-xs"
                        style={{ backgroundColor: '#c0392b' }}>
                        🚨 + Incidente
                    </button>
                </div>

                {(isSuperAdmin || bases.length > 1) && (
                    <div className="flex items-center gap-3 px-4 py-2 rounded-lg mb-6"
                        style={{ backgroundColor: '#1a2736' }}>
                        <span className="text-xs font-bold tracking-widest uppercase text-slate-400">Base</span>
                        <select value={baseSelecionada} onChange={e => handleBaseChange(e.target.value)}
                            className="text-white text-sm outline-none flex-1"
                            style={{ backgroundColor: 'transparent' }}>
                            {isSuperAdmin && <option value="all">Todas as Bases</option>}
                            {bases.map(b => (
                                <option key={b.id} value={b.id}>
                                    {b.code ? `${b.code} — ` : ''}{b.name}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                <div className="flex gap-2 mb-6 flex-wrap">
                    {[
                        { key: 'estoque', label: `Estoque (${estoque.length})` },
                        { key: 'parados', label: `Parados (${parados.length})` },
                        { key: 'incidentes', label: `Incidentes (${incidentesAtivos.length})` },
                        { key: 'extravio', label: `Extravio (${extravios.length})`, alerta: extraviosCriticos.length > 0 },
                        { key: 'relatorios', label: '📊 Relatórios' },
                    ].map((a: any) => (
                        <button key={a.key} onClick={() => setAba(a.key as any)}
                            className="px-5 py-2 rounded font-black tracking-widest uppercase text-sm outline-none"
                            style={{
                                backgroundColor: aba === a.key ? '#00b4b4' : a.alerta ? '#2b0d0d' : '#1a2736',
                                color: a.alerta && aba !== a.key ? '#ff5252' : 'white',
                                border: a.alerta && aba !== a.key ? '1px solid #ff5252' : 'none'
                            }}>
                            {a.label}
                        </button>
                    ))}
                </div>

                {loading && aba !== 'relatorios' ? (
                    <p className="text-slate-400 text-sm">Carregando...</p>
                ) : (
                    <>
                        {/* ─── ESTOQUE ─── */}
                        {aba === 'estoque' && (
                            <div className="flex flex-col gap-4">
                                <div className="grid grid-cols-2 gap-3">
                                    {Object.values(estoquePorCliente).map(c => (
                                        <div key={c.nome} className="rounded-lg p-4" style={{ backgroundColor: '#1a2736' }}>
                                            <p className="text-white font-bold">{c.nome}</p>
                                            <p className="text-3xl font-black text-white mt-1">{c.total}</p>
                                            <div className="flex gap-3 mt-2 text-xs font-bold">
                                                {c.criticos > 0 && <span style={{ color: '#ff5252' }}>🔴 {c.criticos} críticos</span>}
                                                {c.alertas > 0 && <span style={{ color: '#ffb300' }}>🟡 {c.alertas} alerta</span>}
                                                {c.criticos === 0 && c.alertas === 0 && <span style={{ color: '#00e676' }}>✅ OK</span>}
                                            </div>
                                        </div>
                                    ))}
                                    {Object.keys(estoquePorCliente).length === 0 && (
                                        <div className="col-span-2 rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                                            <p className="text-slate-400">Nenhum pacote no armazém</p>
                                        </div>
                                    )}
                                </div>

                                {estoque.length > 0 && (
                                    <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                                            Todos os Pacotes — {estoque.length}
                                        </p>
                                        <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                                            {estoque.map(p => (
                                                <div key={p.id} className="flex items-center justify-between p-3 rounded"
                                                    style={{ backgroundColor: '#0f1923' }}>
                                                    <div>
                                                        <p className="text-white font-mono text-sm">{p.barcode}</p>
                                                        <p className="text-slate-400 text-xs">{(p.clients as any)?.name || '-'}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="px-2 py-1 rounded text-xs font-bold"
                                                            style={{ backgroundColor: bgDias(p.diasParado), color: corDias(p.diasParado) }}>
                                                            {p.diasParado}d
                                                        </span>
                                                        {p.diasParado >= 3 && (
                                                            <button onClick={() => { setPacoteSelecionado(p); setModalIncidente(true) }}
                                                                className="px-2 py-1 rounded text-xs font-bold"
                                                                style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>
                                                                + Incidente
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ─── PARADOS ─── */}
                        {aba === 'parados' && (
                            <div className="flex flex-col gap-4">
                                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3">
                                        Parados no Armazém — {parados.length}
                                    </p>
                                    {parados.length === 0 ? (
                                        <p className="text-slate-500 text-sm">Nenhum pacote parado</p>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            {parados.map(p => (
                                                <div key={p.id} className="flex items-center justify-between p-3 rounded"
                                                    style={{ backgroundColor: '#0f1923' }}>
                                                    <div>
                                                        <p className="text-white font-mono text-sm">{p.barcode}</p>
                                                        <p className="text-slate-400 text-xs">
                                                            {(p.clients as any)?.name || '-'} · Desde {new Date(p.created_at).toLocaleDateString('pt-BR')}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="px-3 py-1 rounded text-xs font-bold"
                                                            style={{ backgroundColor: bgDias(p.diasParado), color: corDias(p.diasParado) }}>
                                                            {p.diasParado} dias
                                                        </span>
                                                        <button onClick={() => { setPacoteSelecionado(p); setModalIncidente(true) }}
                                                            className="px-2 py-1 rounded text-xs font-bold"
                                                            style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>
                                                            + Incidente
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-1">
                                        Insucessos Aguardando Retorno — {paradosMotorista.length}
                                    </p>
                                    <p className="text-xs text-slate-500 mb-3">
                                        Pacotes que saíram com motorista e não foram entregues
                                    </p>
                                    {paradosMotorista.length === 0 ? (
                                        <p className="text-slate-500 text-sm">Nenhum pacote pendente</p>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            {paradosMotorista.map(p => (
                                                <div key={p.id} className="flex items-center justify-between p-3 rounded"
                                                    style={{ backgroundColor: '#0f1923' }}>
                                                    <div>
                                                        <p className="text-white font-mono text-sm">{p.barcode}</p>
                                                        <p className="text-slate-400 text-xs">{(p.clients as any)?.name || '-'}</p>
                                                    </div>
                                                    <span className="px-3 py-1 rounded text-xs font-bold"
                                                        style={{ backgroundColor: '#2b0d0d', color: '#ff5252' }}>
                                                        ❌ Insucesso
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ─── INCIDENTES ─── */}
                        {aba === 'incidentes' && (
                            <div className="flex flex-col gap-3">
                                {incidentesAtivos.length === 0 ? (
                                    <div className="rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                                        <p className="text-slate-400">Nenhum incidente pendente</p>
                                    </div>
                                ) : (
                                    incidentesAtivos.map(inc => {
                                        const statusDisplay = statusIncidenteDisplay(inc)
                                        return (
                                            <div key={inc.id} className="rounded-lg p-4" style={{ backgroundColor: '#1a2736' }}>
                                                <div className="flex items-start justify-between">
                                                    <div>
                                                        <p className="text-white font-mono font-bold">{inc.barcode}</p>
                                                        <p className="text-slate-400 text-xs mt-1">
                                                            {tipoIncidente[inc.type]} · {new Date(inc.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                                                        </p>
                                                        {inc.description && (
                                                            <p className="text-slate-300 text-xs mt-1">{inc.description}</p>
                                                        )}
                                                        {inc.operator_name && (
                                                            <p className="text-slate-500 text-xs mt-1">👤 {inc.operator_name}</p>
                                                        )}
                                                    </div>
                                                    <span className="px-2 py-1 rounded text-xs font-bold flex-shrink-0 ml-2"
                                                        style={{
                                                            backgroundColor: statusDisplay.bg,
                                                            color: statusDisplay.color,
                                                            border: `1px solid ${statusDisplay.color}`
                                                        }}>
                                                        {statusDisplay.label}
                                                    </span>
                                                </div>
                                            </div>
                                        )
                                    })
                                )}
                            </div>
                        )}

                        {/* ─── EXTRAVIO ─── */}
                        {aba === 'extravio' && (
                            <div className="flex flex-col gap-3">
                                {extraviosCriticos.length > 0 && (
                                    <div className="rounded-lg p-4"
                                        style={{ backgroundColor: '#2b0d0d', border: '1px solid #ff5252' }}>
                                        <p className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: '#ff5252' }}>
                                            ⚠️ {extraviosCriticos.length} pacote(s) com 6+ dias — prontos para Lost
                                        </p>
                                        <p className="text-xs text-slate-400">
                                            Esses pacotes passaram do prazo de 6 dias. Confirme o Lost para encerrar o ciclo.
                                        </p>
                                    </div>
                                )}
                                {extravios.length === 0 ? (
                                    <div className="rounded-lg p-8 text-center" style={{ backgroundColor: '#1a2736' }}>
                                        <p className="text-slate-400">Nenhum pacote em extravio</p>
                                    </div>
                                ) : (
                                    <div className="rounded-lg p-5" style={{ backgroundColor: '#1a2736' }}>
                                        <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-1">
                                            Em Extravio — {extravios.length} pacotes
                                        </p>
                                        <p className="text-xs text-slate-500 mb-3">
                                            Para localizar um pacote, use o módulo Localizar. O status será encerrado automaticamente.
                                        </p>
                                        <div className="flex flex-col gap-2">
                                            {extravios.map(p => {
                                                const dias = diasExtravio(p.created_at)
                                                const critico = dias >= 6
                                                return (
                                                    <div key={p.id} className="flex items-center justify-between p-3 rounded"
                                                        style={{ backgroundColor: '#0f1923', border: critico ? '1px solid #ff5252' : 'none' }}>
                                                        <div>
                                                            <p className="text-white font-mono text-sm">{p.barcode}</p>
                                                            <p className="text-slate-400 text-xs">
                                                                {(p.clients as any)?.name || '-'} · Extravio há {dias} dia(s)
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="px-2 py-1 rounded text-xs font-bold"
                                                                style={{
                                                                    backgroundColor: critico ? '#2b0d0d' : '#2b1f0d',
                                                                    color: critico ? '#ff5252' : '#ffb300'
                                                                }}>
                                                                {dias}d
                                                            </span>
                                                            {critico && (
                                                                <button onClick={() => marcarComoLost(p)}
                                                                    className="px-2 py-1 rounded text-xs font-bold"
                                                                    style={{ backgroundColor: '#2b0d0d', color: '#ff5252', border: '1px solid #ff5252' }}>
                                                                    💀 Lost
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ─── RELATÓRIOS ─── */}
                        {aba === 'relatorios' && (
                            <div className="flex flex-col gap-4">
                                <div className="rounded-lg p-4 flex flex-col gap-3" style={{ backgroundColor: '#1a2736' }}>
                                    <p className="text-xs font-bold tracking-widest uppercase text-slate-400">Período e Base</p>
                                    <div className="flex gap-3 flex-wrap">
                                        <div className="flex flex-col gap-1 flex-1">
                                            <label className="text-xs text-slate-500">De</label>
                                            <input type="date" value={relDataInicio}
                                                onChange={e => setRelDataInicio(e.target.value)}
                                                max={hojeFormatado()}
                                                className="px-3 py-2 rounded text-white text-sm outline-none"
                                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52', colorScheme: 'dark' }} />
                                        </div>
                                        <div className="flex flex-col gap-1 flex-1">
                                            <label className="text-xs text-slate-500">Até</label>
                                            <input type="date" value={relDataFim}
                                                onChange={e => setRelDataFim(e.target.value)}
                                                max={hojeFormatado()}
                                                className="px-3 py-2 rounded text-white text-sm outline-none"
                                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52', colorScheme: 'dark' }} />
                                        </div>
                                    </div>
                                    {(isSuperAdmin || bases.length > 1) && (
                                        <select value={relBase} onChange={e => setRelBase(e.target.value)}
                                            className="px-3 py-2 rounded text-white text-sm outline-none"
                                            style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                            {isSuperAdmin && <option value="all">Todas as Bases</option>}
                                            {bases.map(b => (
                                                <option key={b.id} value={b.id}>
                                                    {b.code ? `${b.code} — ` : ''}{b.name}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    {relatorios.map(r => (
                                        <button key={r.key}
                                            onClick={() => gerarRelatorio(r.key)}
                                            disabled={!!relCarregando}
                                            className="rounded-lg p-4 text-left disabled:opacity-50 outline-none hover:opacity-90"
                                            style={{
                                                backgroundColor: r.key === 'geral' ? '#00b4b4' : '#1a2736',
                                                border: r.key === 'geral' ? 'none' : '1px solid #2a3f52'
                                            }}>
                                            <p className="text-white font-bold text-sm">
                                                {relCarregando === r.key ? '⏳ Gerando...' : r.label}
                                            </p>
                                            <p className="text-slate-400 text-xs mt-1">{r.desc}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ─── Modal Incidente por Bipe ─── */}
            {modalBipe && (
                <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
                    <div className="w-full max-w-md rounded-lg p-6 flex flex-col gap-4"
                        style={{ backgroundColor: '#1a2736' }}>
                        <div className="flex justify-between items-center">
                            <h2 className="text-white font-black tracking-widest uppercase">🚨 Abrir Incidente</h2>
                            <button onClick={() => setModalBipe(false)} className="text-slate-400 hover:text-white">✕</button>
                        </div>

                        {!bipePacote && (
                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-bold tracking-widest uppercase text-slate-400">
                                    Bipe ou digite o código
                                </label>
                                <input ref={bipeRef} type="text" value={bipeBarcode}
                                    onChange={e => setBipeBarcode(e.target.value)}
                                    onKeyDown={handleBipeBusca}
                                    placeholder="Código do pacote + Enter"
                                    className="px-4 py-3 rounded text-white text-sm outline-none"
                                    style={{ backgroundColor: '#0f1923', border: '2px solid #00b4b4' }}
                                    autoFocus />
                                {bipeBuscando && <p className="text-xs text-slate-400">Buscando...</p>}
                                {bipeErro && <p className="text-xs font-bold" style={{ color: '#ff5252' }}>❌ {bipeErro}</p>}
                            </div>
                        )}

                        {bipePacote && (
                            <>
                                <div className="px-3 py-2 rounded flex items-center justify-between"
                                    style={{ backgroundColor: '#0f1923' }}>
                                    <div>
                                        <p className="text-white font-mono text-sm">{bipePacote.barcode}</p>
                                        <p className="text-slate-400 text-xs">
                                            {(bipePacote.clients as any)?.name || '-'} · {bipePacote.diasParado} dia(s) no armazém
                                        </p>
                                    </div>
                                    <button onClick={() => { setBipePacote(null); setBipeBarcode(''); setTimeout(() => bipeRef.current?.focus(), 100) }}
                                        className="text-slate-500 hover:text-white text-xs">trocar</button>
                                </div>

                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Tipo de Incidente</label>
                                    <select value={bipeTipo} onChange={e => setBipeTipo(e.target.value)}
                                        className="px-4 py-3 rounded text-white text-sm outline-none"
                                        style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                        {Object.entries(tipoIncidente).map(([key, label]) => (
                                            <option key={key} value={key}>{label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Descrição (opcional)</label>
                                    <textarea value={bipeDesc} onChange={e => setBipeDesc(e.target.value)}
                                        placeholder="Descreva o que aconteceu..."
                                        rows={3}
                                        className="px-4 py-3 rounded text-white text-sm outline-none resize-none"
                                        style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                                </div>

                                <button onClick={confirmarIncidenteBipe} disabled={bipeSalvando}
                                    className="py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                                    style={{ backgroundColor: '#c0392b' }}>
                                    {bipeSalvando ? 'Salvando...' : 'Confirmar Incidente'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ─── Modal Incidente por Lista ─── */}
            {modalIncidente && pacoteSelecionado && (
                <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
                    <div className="w-full max-w-md rounded-lg p-6 flex flex-col gap-4"
                        style={{ backgroundColor: '#1a2736' }}>
                        <div className="flex justify-between items-center">
                            <h2 className="text-white font-black tracking-widest uppercase">Abrir Incidente</h2>
                            <button onClick={() => setModalIncidente(false)} className="text-slate-400 hover:text-white">✕</button>
                        </div>

                        <div className="px-3 py-2 rounded" style={{ backgroundColor: '#0f1923' }}>
                            <p className="text-white font-mono text-sm">{pacoteSelecionado.barcode}</p>
                            <p className="text-slate-400 text-xs">
                                {(pacoteSelecionado.clients as any)?.name} · {pacoteSelecionado.diasParado} dias parado
                            </p>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Tipo de Incidente</label>
                            <select value={tipoInc} onChange={e => setTipoInc(e.target.value)}
                                className="px-4 py-3 rounded text-white text-sm outline-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }}>
                                {Object.entries(tipoIncidente).map(([key, label]) => (
                                    <option key={key} value={key}>{label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold tracking-widest uppercase text-slate-400">Descrição (opcional)</label>
                            <textarea value={descInc} onChange={e => setDescInc(e.target.value)}
                                placeholder="Descreva o que aconteceu..."
                                rows={3}
                                className="px-4 py-3 rounded text-white text-sm outline-none resize-none"
                                style={{ backgroundColor: '#0f1923', border: '1px solid #2a3f52' }} />
                        </div>

                        <button onClick={abrirIncidente} disabled={salvandoInc}
                            className="py-3 rounded font-black tracking-widest uppercase text-white text-sm disabled:opacity-50"
                            style={{ backgroundColor: '#c0392b' }}>
                            {salvandoInc ? 'Salvando...' : 'Confirmar Incidente'}
                        </button>
                    </div>
                </div>
            )}
        </main>
    )
}