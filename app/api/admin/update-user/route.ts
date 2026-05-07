import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
    try {
        const { user_id, email, name } = await req.json()

        if (!user_id) {
            return NextResponse.json({ error: 'user_id obrigatório' }, { status: 400 })
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        // Atualiza email no Auth se fornecido
        if (email) {
            const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(user_id, { email })
            if (authError) {
                return NextResponse.json({ error: `Erro ao atualizar email: ${authError.message}` }, { status: 400 })
            }
        }

        // Atualiza nome na tabela public.users se fornecido
        if (name) {
            const { error: nameError } = await supabaseAdmin
                .schema('public')
                .from('users')
                .update({ name })
                .eq('id', user_id)
            if (nameError) {
                return NextResponse.json({ error: `Erro ao atualizar nome: ${nameError.message}` }, { status: 400 })
            }
        }

        return NextResponse.json({ success: true })
    } catch (err: any) {
        console.error(err)
        return NextResponse.json({ error: err.message || 'Erro interno' }, { status: 500 })
    }
}