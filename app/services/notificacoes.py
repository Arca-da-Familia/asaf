"""v3.2.1 (adaptado, 2026-09-17) - envio de e-mail via SMTP, usando a própria caixa de e-mail
institucional da ASAF (Google Workspace do domínio asaf.org.br - MX já apontado pra lá, sem
contratar nada novo). Credenciais vêm de variáveis de ambiente (SMTP_HOST/SMTP_PORTA/
SMTP_USUARIO/SMTP_SENHA/SMTP_REMETENTE), populadas a partir do Key Vault no deploy/na rotina
agendada - nunca hardcoded, mesmo padrão de DATABASE_URL/JWT_SECRET. Usa só a biblioteca padrão
(`smtplib`) - nenhuma dependência nova."""
import os
import smtplib
from typing import Optional
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def smtp_configurado() -> bool:
    return bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_USUARIO") and os.environ.get("SMTP_SENHA"))


def _remetente() -> str:
    return os.environ.get("SMTP_REMETENTE") or os.environ["SMTP_USUARIO"]


def _montar(remetente: str, destinatario: str, assunto: str, corpo_texto: str, cabecalhos: Optional[dict] = None) -> str:
    mensagem = MIMEMultipart()
    mensagem["From"] = remetente
    mensagem["To"] = destinatario
    mensagem["Subject"] = assunto
    for nome, valor in (cabecalhos or {}).items():  # v6.2b: List-Unsubscribe nos e-mails que a pessoa pode desligar
        mensagem[nome] = valor
    mensagem.attach(MIMEText(corpo_texto, "plain", "utf-8"))
    return mensagem.as_string()


def _conectar() -> smtplib.SMTP:
    if not smtp_configurado():
        raise RuntimeError("SMTP não configurado no ambiente (SMTP_HOST/SMTP_USUARIO/SMTP_SENHA ausentes).")
    servidor = smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORTA", "587")), timeout=30)
    try:
        servidor.starttls()
        servidor.login(os.environ["SMTP_USUARIO"], os.environ["SMTP_SENHA"])
    except Exception:
        servidor.close()
        raise
    return servidor


def enviar_email(destinatario: str, assunto: str, corpo_texto: str, cabecalhos: Optional[dict] = None) -> None:
    with _conectar() as servidor:
        remetente = _remetente()
        servidor.sendmail(remetente, [destinatario], _montar(remetente, destinatario, assunto, corpo_texto, cabecalhos))


class ConexaoDeEmail:
    """v6.2a - várias mensagens numa conexão só (o envio em lotes dos avisos do mural): `with ConexaoDeEmail() as c: c.enviar(...)`. Cada `enviar` levanta a exceção do servidor
    de e-mail daquela mensagem (quem chama decide se é recusa do endereço, falha passageira ou o limite diário do Google)."""

    def __enter__(self) -> "ConexaoDeEmail":
        self.servidor = _conectar()
        self.remetente = _remetente()
        return self

    def enviar(self, destinatario: str, assunto: str, corpo_texto: str, cabecalhos: Optional[dict] = None) -> None:
        self.servidor.sendmail(self.remetente, [destinatario], _montar(self.remetente, destinatario, assunto, corpo_texto, cabecalhos))

    def __exit__(self, *_erro) -> None:
        try:
            self.servidor.quit()
        except Exception:  # noqa: BLE001 - a conexão já caiu: não há o que fechar
            self.servidor.close()
