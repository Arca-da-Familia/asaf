"""SÓ HOMOLOGAÇÃO - dado ANTIGO inventado, para a rotina de guarda (v7.1d) agir de verdade no banco de teste e o robô `v7.1d-01` conferir o resultado.

Na homologação nada tem 5 ou 10 anos (ela nasceu em 2026), então os prazos novos nunca agiriam lá. A cada publicação de teste, ANTES da rotina de guarda, este roteiro grava um
conjunto novo, tudo inventado e marcado como teste:
  - um evento de 6 anos atrás com um participante externo (inscrito, presente, com respostas, QR e e-mail): a rotina limpa a inscrição e anonimiza a pessoa;
  - um voluntário cujo último termo de adesão acabou há 6 anos, com uma hora registrada: a rotina tira as referências e o texto e encerra o papel;
  - um evento de 11 anos atrás com um certificado emitido (com arquivo de verdade no armazenamento de TESTE e o código `HMLRETENCAO<id do evento>`): a rotina apaga o
    arquivo e o nome, e a verificação continua dizendo que é válido;
  - uma entrada da Auditoria de 11 anos atrás (ação `TESTE_DA_RETENCAO`, com IP e valor inventados): a rotina tira quem, o IP e os valores.
A produção nunca recebe isto.

Segurança: recusa rodar se o `DATABASE_URL` não for o do banco `asaf_hml` e confere de novo o nome do banco antes de qualquer escrita.

Depois da rotina, `python scripts/hml_dados_antigos_da_retencao.py depois` move a entrada antiga da Auditoria (já sem quem, IP e valores) para 01/06/2025: o relatório
anual da homologação conta o início de uso pelo primeiro registro da Auditoria, e o início fictício é 02/01/2025 (scripts/hml_inicio_do_sistema.py).

Uso: `python scripts/hml_dados_antigos_da_retencao.py [depois]` a partir da raiz do repositório, com `DATABASE_URL` (o do banco de teste) e `ARMAZENAMENTO_BLOB_URL` (o de teste)."""
import json
import os
import secrets
import sys
from datetime import datetime, timedelta

from sqlalchemy import text

BANCO_HML = "asaf_hml"
ACAO_DE_TESTE = "TESTE_DA_RETENCAO"
MOVER_PARA = datetime(2025, 6, 1, 12, 0)
TITULO_DO_EVENTO = "Evento antigo do teste da retenção"
TITULO_DO_CERTIFICADO = "Evento antigo do certificado do teste da retenção"


def _cpf_inventado() -> str:
    return f"{secrets.randbelow(10**11):011d}"


def semear(db, agora: datetime) -> dict:
    """Grava o conjunto (quem chama confere o banco antes). Devolve o que gravou."""
    from app.models.core import AuditLog
    from app.models.eventos import Evento
    from app.models.motores import DocumentoEmitido, Inscricao, RegistroPresenca, TemplateDocumento
    from app.models.pessoas import Papel, Pessoa
    from app.models.voluntariado import RegistroHorasVoluntariado, TermoAdesaoVoluntario
    from app.services import armazenamento

    seis_anos, onze_anos = agora - timedelta(days=6 * 365), agora - timedelta(days=11 * 365)
    marca = agora.strftime("%Y%m%d%H%M%S")

    participante = Pessoa(nome_completo=f"Participante inventado da retenção {marca}", cpf=_cpf_inventado(),
                          email_contato=f"retencao.participante.{marca}@homologacao.example.com", telefone_whatsapp="91900000000")
    voluntario = Pessoa(nome_completo=f"Voluntário inventado da retenção {marca}", cpf=_cpf_inventado(),
                        email_contato=f"retencao.voluntario.{marca}@homologacao.example.com")
    db.add_all([participante, voluntario])
    db.flush()
    db.add_all([Papel(id_pessoa=participante.id_pessoa, tipo_papel="participante_externo", ativo=True, criado_em=seis_anos),
                Papel(id_pessoa=voluntario.id_pessoa, tipo_papel="voluntario", ativo=True, criado_em=seis_anos - timedelta(days=200))])

    evento = Evento(titulo=f"{TITULO_DO_EVENTO} {marca}", categoria="PALESTRA", data_hora_inicio=seis_anos - timedelta(hours=2), data_hora_fim=seis_anos)
    evento_do_certificado = Evento(titulo=f"{TITULO_DO_CERTIFICADO} {marca}", categoria="PALESTRA", data_hora_inicio=onze_anos - timedelta(hours=2),
                                   data_hora_fim=onze_anos)
    db.add_all([evento, evento_do_certificado])
    db.flush()
    for e in (evento, evento_do_certificado):
        db.add(Inscricao(contexto_tipo="Evento", id_contexto=e.id_evento, id_pessoa=participante.id_pessoa, status="Presente",
                         respostas_formulario=json.dumps({"1": "resposta inventada"}), codigo_checkin=secrets.token_hex(8),
                         token_cancelamento=secrets.token_urlsafe(16), email_da_inscricao=participante.email_contato, data_inscricao=e.data_hora_inicio))
        db.add(RegistroPresenca(contexto_tipo="Evento", id_contexto=e.id_evento, id_pessoa=participante.id_pessoa, meio_registro="QR",
                                hora_entrada=e.data_hora_inicio))

    termo = TermoAdesaoVoluntario(id_pessoa=voluntario.id_pessoa, atividade="Atividade inventada do teste da retenção", carga_horaria_semanal=2,
                                  data_inicio=seis_anos - timedelta(days=200), data_fim_vigencia=seis_anos, documento_referencia="Termo inventado",
                                  ativo=True)
    db.add(termo)
    db.flush()
    db.add(RegistroHorasVoluntariado(id_termo=termo.id_termo, data=seis_anos - timedelta(days=30), horas=3, descricao_atividade="Texto inventado das horas",
                                     status="APROVADO"))

    modelo = db.query(TemplateDocumento).filter(TemplateDocumento.codigo == "CERTIFICADO_EVENTO").first()
    if modelo is None:
        modelo = TemplateDocumento(codigo="CERTIFICADO_EVENTO", nome="Certificado de participação", corpo_texto="Certificamos que {nome_completo} participou.")
        db.add(modelo)
        db.flush()
    codigo = f"HMLRETENCAO{evento_do_certificado.id_evento}"
    caminho = armazenamento.salvar_novo("documentos", ".pdf", b"%PDF-1.4\n% certificado inventado do teste da retencao\n", nome=f"{codigo}.pdf")
    proximo = (db.query(DocumentoEmitido.numero_sequencial).order_by(DocumentoEmitido.numero_sequencial.desc()).limit(1).scalar() or 0) + 1
    db.add(DocumentoEmitido(id_template=modelo.id_template, numero_sequencial=proximo, contexto_tipo="Evento", id_contexto=evento_do_certificado.id_evento,
                            id_pessoa=participante.id_pessoa, caminho_arquivo=caminho, emitida_em=onze_anos, codigo_verificacao=codigo,
                            variaveis_usadas=json.dumps({"nome_completo": participante.nome_completo, "titulo_evento": evento_do_certificado.titulo},
                                                        ensure_ascii=False)))
    db.add(AuditLog(tabela_afetada="homologacao", acao=ACAO_DE_TESTE, id_registro_afetado=evento.id_evento, timestamp=onze_anos, ip_origem="10.11.12.13",
                    dados_depois=json.dumps({"nome": "Pessoa inventada", "motivo": "Só na homologação: entrada antiga para a rotina de guarda agir."},
                                            ensure_ascii=False)))
    db.commit()
    return {"evento": evento.id_evento, "evento_do_certificado": evento_do_certificado.id_evento, "codigo": codigo, "voluntario": voluntario.id_pessoa,
            "participante": participante.id_pessoa}


def mover_a_auditoria_antiga(db) -> int:
    """A entrada de teste JÁ anonimizada vai para 01/06/2025 (a que a rotina não anonimizou fica onde está: o robô acusa)."""
    from app.models.core import AuditLog

    n = db.query(AuditLog).filter(AuditLog.acao == ACAO_DE_TESTE, AuditLog.timestamp < MOVER_PARA, AuditLog.ip_origem.is_(None),
                                  AuditLog.dados_depois.is_(None)).update({AuditLog.timestamp: MOVER_PARA}, synchronize_session=False)
    db.commit()
    return n


def main() -> int:
    if f"/{BANCO_HML}" not in os.environ.get("DATABASE_URL", ""):
        raise SystemExit(f"RECUSADO: DATABASE_URL não aponta para o banco de teste ('{BANCO_HML}').")
    from app.database import SessaoLocal

    db = SessaoLocal()
    try:
        nome = db.execute(text("SELECT current_database()")).scalar()
        if nome != BANCO_HML:
            raise SystemExit(f"RECUSADO: este roteiro só roda no banco de teste ('{BANCO_HML}'), não em '{nome}'.")
        if sys.argv[1:] == ["depois"]:
            print(f"[hml-dados-antigos-da-retencao] entradas antigas da Auditoria movidas para 01/06/2025: {mover_a_auditoria_antiga(db)}")
        else:
            print(f"[hml-dados-antigos-da-retencao] gravado: {semear(db, datetime.utcnow())}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
