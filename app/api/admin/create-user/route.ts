import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
    try {
        const { email, name, cargo, company_id, bases_ids, permissoes } = await req.json()

        if (!email || !name || !cargo || !company_id) {
            return NextResponse.json({ error: 'Campos obrigatórios faltando' }, { status: 400 })
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        // Cria o usuário no Auth com senha padrão
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: 'Teste@123',
            email_confirm: true,
        })

        if (authError || !authData.user) {
            return NextResponse.json({ error: authError?.message || 'Erro ao criar usuário' }, { status: 400 })
        }

        const userId = authData.user.id

        // Cria o registro na tabela users
        const { error: userError } = await supabaseAdmin.from('users').insert({
            id: userId,
            email,
            name,
            cargo,
            company_id,
            active: true,
            first_login: true,
            permissoes: permissoes || {}
        })

        if (userError) {
            // Rollback: remove o usuário do Auth se falhou na tabela
            await supabaseAdmin.auth.admin.deleteUser(userId)
            return NextResponse.json({ error: 'Erro ao salvar dados do usuário' }, { status: 400 })
        }

        // Vincula às bases selecionadas
        if (bases_ids && bases_ids.length > 0) {
            const userBases = bases_ids.map((bid: string) => ({
                user_id: userId,
                company_id: bid
            }))
            await supabaseAdmin.from('user_bases').insert(userBases)
        }

        return NextResponse.json({ success: true, user_id: userId })
    } catch (err) {
        console.error(err)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}