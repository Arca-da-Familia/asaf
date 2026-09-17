"""v3.2.1 (adaptado, 2026-09-17) - envio de e-mail via SMTP, usando a própria caixa de e-mail
institucional da ASAF (Google Workspace do domínio asaf.org.br - MX já apontado pra lá, sem
contratar nada novo). Credenciais vêm de variáveis de ambiente (SMTP_HOST/SMTP_PORTA/
SMTP_USUARIO/SMTP_SENHA/SMTP_REMETENTE), populadas a partir do Key Vault no deploy/na rotina
agendada - nunca hardcoded, mesmo padrão de DATABASE_URL/JWT_SECRET. Usa só a biblioteca padrão
(`smtplib`) - nenhuma dependência nova."""
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def smtp_configurado() -> bool:
    return bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_USUARIO") and os.environ.get("SMTP_SENHA"))


def enviar_email(destinatario: str, assunto: str, corpo_texto: str) -> None:
    if not smtp_configurado():
        raise RuntimeError("SMTP não configurado no ambiente (SMTP_HOST/SMTP_USUARIO/SMTP_SENHA ausentes).")

    remetente = os.environ.get("SMTP_REMETENTE") or os.environ["SMTP_USUARIO"]
    mensagem = MIMEMultipart()
    mensagem["From"] = remetente
    mensagem["To"] = destinatario
    mensagem["Subject"] = assunto
    mensagem.attach(MIMEText(corpo_texto, "plain", "utf-8"))

    host = os.environ["SMTP_HOST"]
    porta = int(os.environ.get("SMTP_PORTA", "587"))
    with smtplib.SMTP(host, porta, timeout=30) as servidor:
        servidor.starttls()
        servidor.login(os.environ["SMTP_USUARIO"], os.environ["SMTP_SENHA"])
        servidor.sendmail(remetente, [destinatario], mensagem.as_string())
