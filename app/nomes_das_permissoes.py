"""v9.3g (pedido do Presidente, 06/11: nada de nome técnico na tela): o nome curto, em português, de cada permissão do sistema. O código
(`exportar_dados_pessoais`) continua sendo a chave que o sistema confere; a tela mostra este nome. Permissão nova sem nome reprova
`tests/test_nomes_das_permissoes.py`; enquanto isso, o nome de reserva troca o sublinhado por espaço."""

NOME_DA_PERMISSAO: dict[str, str] = {
    "editar_site": "Abrir o editor do site",
    "gerenciar_acesso": "Gerenciar níveis de acesso e permissões",
    "associados": "Cadastro de associados",
    "financeiro": "Financeiro (operar)",
    "financeiro_auditar": "Financeiro (auditar, sem operar)",
    "governanca": "Assembleias e votações",
    "projetos": "Projetos, eventos e voluntariado",
    "auditoria": "Consultar a Auditoria",
    "ver_cpf_completo": "Ver o CPF completo",
    "exportar_dados_pessoais": "Exportar dados pessoais de associados",
    "forcar_cadastro_duplicado": "Cadastrar mesmo com cadastro parecido",
    "gerenciar_checkin_evento": "Portaria, crachá e certificado de evento",
    "exportar_presencas_evento": "Exportar presenças de evento",
    "exportar_inscricoes_evento": "Exportar inscritos de evento",
    "exportar_beneficiarios": "Exportar beneficiários",
    "exportar_reservas_espaco": "Exportar reservas de espaço",
    "documentos": "Documentos institucionais",
    "documentos_originais": "Baixar o original de documento restrito",
    "aprovar_publicacao": "Aprovar publicações da transparência",
    "parcerias": "Parcerias e emendas",
    "atendimento": "Atendimento (fila do site)",
    "comunicar": "Publicar avisos",
    "privacidade": "Programa de privacidade (consultar)",
    "privacidade_gerir": "Programa de privacidade (gerir)",
}


def nome_da_permissao(codigo: str) -> str:
    if codigo in NOME_DA_PERMISSAO:
        return NOME_DA_PERMISSAO[codigo]
    texto = codigo.replace("_", " ").strip()
    return texto[:1].upper() + texto[1:]
