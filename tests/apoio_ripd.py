"""v7.0d - apoio da suíte: o relatório de impacto do atendimento social aprovado (o conftest chama no começo; os testes da trava, ao terminar)."""


def aprovar_relatorio_do_atendimento_social():
    """v7.0d - o prontuário e o encaminhamento só gravam com o relatório de impacto (RIPD) aprovado: a suíte começa com ele aprovado (como a produção
    depois que a Presidência aprova), e os testes da trava (tests/test_relatorio_de_impacto.py) suspendem e aprovam de novo."""
    from app.database import SessaoLocal
    from app.models.core import Usuario
    from app.services import relatorio_de_impacto

    sessao = SessaoLocal()
    try:
        if relatorio_de_impacto.aprovado(sessao, "ATENDIMENTO_SOCIAL") is None:
            usuario = sessao.query(Usuario).order_by(Usuario.id_usuario).first()
            secoes = {chave: f"Seção preenchida para a suíte de testes ({chave})." for chave, _ in relatorio_de_impacto.SECOES}
            relatorio_de_impacto.salvar_rascunho(sessao, usuario, "ATENDIMENTO_SOCIAL", secoes)
            relatorio_de_impacto.aprovar(sessao, usuario, "ATENDIMENTO_SOCIAL")
    finally:
        sessao.close()
