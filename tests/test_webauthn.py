"""v0.4 (adendo pós-fechamento da FASE 0) - passkey (WebAuthn).

Não há navegador real disponível em CI/teste automatizado, então esta suíte implementa um
"autenticador virtual" mínimo: gera uma chave EC P-256 de verdade (`cryptography`), monta
`authenticatorData`/`attestationObject` (formato "none", o mais simples de fabricar
corretamente) via CBOR (`cbor2`) e assina o desafio de autenticação com a chave privada -
exatamente a forma que `webauthn.verify_registration_response`/`verify_authentication_response`
esperam receber de um navegador real. Isso testa a criptografia de ponta a ponta (não é mock:
uma assinatura errada, challenge trocado ou rp_id_hash errado FALHA de verdade), só o "clique no
Windows Hello" em si que não existe aqui.
"""
import hashlib
import uuid

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

from app.security import WEBAUTHN_ORIGIN, WEBAUTHN_RP_ID
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url


def _rp_id_hash() -> bytes:
    return hashlib.sha256(WEBAUTHN_RP_ID.encode()).digest()


def _client_data_json(tipo: str, challenge_b64url: str) -> bytes:
    import json
    return json.dumps({
        "type": tipo,
        "challenge": challenge_b64url,
        "origin": WEBAUTHN_ORIGIN,
        "crossOrigin": False,
    }).encode()


def _cose_public_key(public_numbers) -> bytes:
    x = public_numbers.x.to_bytes(32, "big")
    y = public_numbers.y.to_bytes(32, "big")
    return cbor2.dumps({1: 2, 3: -7, -1: 1, -2: x, -3: y})  # EC2, ES256, P-256


def _assinar(private_key, dados: bytes) -> bytes:
    """Assinatura ECDSA em formato DER - o mesmo formato que autenticadores reais produzem e
    que `webauthn.verify_authentication_response` espera."""
    return private_key.sign(dados, ec.ECDSA(hashes.SHA256()))


class AutenticadorVirtual:
    """Simula um autenticador de plataforma (tipo Windows Hello): gera e guarda seu próprio par
    de chaves, nunca expõe a privada para fora desta classe - só assina o que é pedido."""

    def __init__(self):
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = uuid.uuid4().bytes
        self.sign_count = 0

    def responder_registro(self, challenge: bytes) -> dict:
        challenge_b64url = bytes_to_base64url(challenge)
        client_data = _client_data_json("webauthn.create", challenge_b64url)

        flags = 0x41 | 0x04  # UP (0x01) + AT (0x40) + UV (0x04)
        auth_data = (
            _rp_id_hash()
            + bytes([flags])
            + self.sign_count.to_bytes(4, "big")
            + bytes(16)  # AAGUID zerado (autenticador "genérico" de teste)
            + len(self.credential_id).to_bytes(2, "big")
            + self.credential_id
            + _cose_public_key(self.private_key.public_key().public_numbers())
        )
        attestation_object = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})

        return {
            "id": bytes_to_base64url(self.credential_id),
            "rawId": bytes_to_base64url(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": bytes_to_base64url(client_data),
                "attestationObject": bytes_to_base64url(attestation_object),
                "transports": ["internal"],
            },
        }

    def responder_login(self, challenge: bytes) -> dict:
        challenge_b64url = bytes_to_base64url(challenge)
        client_data = _client_data_json("webauthn.get", challenge_b64url)
        client_data_hash = hashlib.sha256(client_data).digest()

        self.sign_count += 1
        flags = 0x01 | 0x04  # UP + UV, sem AT (não é registro)
        auth_data = _rp_id_hash() + bytes([flags]) + self.sign_count.to_bytes(4, "big")

        assinatura = _assinar(self.private_key, auth_data + client_data_hash)

        return {
            "id": bytes_to_base64url(self.credential_id),
            "rawId": bytes_to_base64url(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": bytes_to_base64url(client_data),
                "authenticatorData": bytes_to_base64url(auth_data),
                "signature": bytes_to_base64url(assinatura),
            },
        }


def test_webauthn_iniciar_registro_exige_autenticacao(client):
    r = client.post("/auth/webauthn/registrar/iniciar")
    assert r.status_code == 401


def test_webauthn_login_iniciar_e_publico_e_devolve_opcoes(client):
    r = client.post("/auth/webauthn/login/iniciar")
    assert r.status_code == 200
    corpo = r.json()
    assert "opcoes" in corpo and "desafio_token" in corpo
    assert corpo["opcoes"]["rpId"] == WEBAUTHN_RP_ID
    assert corpo["opcoes"]["userVerification"] == "required"


def test_ciclo_completo_registro_e_login_por_passkey(client, auth_headers):
    # Registro: iniciar -> responder com o autenticador virtual -> concluir.
    iniciar = client.post("/auth/webauthn/registrar/iniciar", headers=auth_headers)
    assert iniciar.status_code == 200, iniciar.text
    corpo = iniciar.json()
    assert corpo["opcoes"]["authenticatorSelection"]["residentKey"] == "required"
    assert corpo["opcoes"]["authenticatorSelection"]["userVerification"] == "required"

    challenge = base64url_to_bytes(corpo["opcoes"]["challenge"])
    autenticador = AutenticadorVirtual()
    resposta_registro = autenticador.responder_registro(challenge)

    concluir = client.post(
        "/auth/webauthn/registrar/concluir",
        headers=auth_headers,
        json={
            "credencial": resposta_registro,
            "desafio_token": corpo["desafio_token"],
            "apelido": "Notebook de teste",
        },
    )
    assert concluir.status_code == 200, concluir.text
    assert concluir.json()["apelido"] == "Notebook de teste"

    # Listagem confirma a passkey recém-criada.
    listagem = client.get("/auth/webauthn/credenciais", headers=auth_headers)
    assert listagem.status_code == 200
    assert any(c["apelido"] == "Notebook de teste" for c in listagem.json())

    # Login por passkey: iniciar (sem token nenhum, público) -> responder -> concluir.
    login_iniciar = client.post("/auth/webauthn/login/iniciar")
    assert login_iniciar.status_code == 200
    login_corpo = login_iniciar.json()
    login_challenge = base64url_to_bytes(login_corpo["opcoes"]["challenge"])
    resposta_login = autenticador.responder_login(login_challenge)

    login_concluir = client.post(
        "/auth/webauthn/login/concluir",
        json={"credencial": resposta_login, "desafio_token": login_corpo["desafio_token"]},
    )
    assert login_concluir.status_code == 200, login_concluir.text
    assert login_concluir.json()["requer_mfa"] is False
    assert login_concluir.json()["access_token"]


def test_webauthn_login_com_credencial_inexistente_e_recusado(client):
    iniciar = client.post("/auth/webauthn/login/iniciar")
    challenge = base64url_to_bytes(iniciar.json()["opcoes"]["challenge"])
    autenticador = AutenticadorVirtual()  # nunca registrado
    resposta = autenticador.responder_login(challenge)

    r = client.post(
        "/auth/webauthn/login/concluir",
        json={"credencial": resposta, "desafio_token": iniciar.json()["desafio_token"]},
    )
    assert r.status_code == 401


def test_webauthn_login_com_assinatura_adulterada_e_recusado(client, auth_headers):
    iniciar = client.post("/auth/webauthn/registrar/iniciar", headers=auth_headers)
    challenge = base64url_to_bytes(iniciar.json()["opcoes"]["challenge"])
    autenticador = AutenticadorVirtual()
    resposta_registro = autenticador.responder_registro(challenge)
    client.post(
        "/auth/webauthn/registrar/concluir",
        headers=auth_headers,
        json={"credencial": resposta_registro, "desafio_token": iniciar.json()["desafio_token"]},
    )

    login_iniciar = client.post("/auth/webauthn/login/iniciar")
    login_challenge = base64url_to_bytes(login_iniciar.json()["opcoes"]["challenge"])
    resposta_login = autenticador.responder_login(login_challenge)
    # Adultera a assinatura (troca 1 byte) - tem que ser recusado pela verificação criptográfica.
    assinatura_bruta = bytearray(base64url_to_bytes(resposta_login["response"]["signature"]))
    assinatura_bruta[-1] ^= 0xFF
    resposta_login["response"]["signature"] = bytes_to_base64url(bytes(assinatura_bruta))

    r = client.post(
        "/auth/webauthn/login/concluir",
        json={"credencial": resposta_login, "desafio_token": login_iniciar.json()["desafio_token"]},
    )
    assert r.status_code == 401


def test_webauthn_remover_credencial(client, auth_headers):
    iniciar = client.post("/auth/webauthn/registrar/iniciar", headers=auth_headers)
    challenge = base64url_to_bytes(iniciar.json()["opcoes"]["challenge"])
    autenticador = AutenticadorVirtual()
    resposta_registro = autenticador.responder_registro(challenge)
    concluir = client.post(
        "/auth/webauthn/registrar/concluir",
        headers=auth_headers,
        json={"credencial": resposta_registro, "desafio_token": iniciar.json()["desafio_token"]},
    )
    id_credencial = concluir.json()["id_credencial"]

    r = client.delete(f"/auth/webauthn/credenciais/{id_credencial}", headers=auth_headers)
    assert r.status_code == 200

    listagem = client.get("/auth/webauthn/credenciais", headers=auth_headers)
    assert all(c["id_credencial"] != id_credencial for c in listagem.json())
