"""v6.1 (FASE 6) - o que a tela do painel manda para publicar, conferir o grupo e retirar um aviso (ver app/services/comunicacao.py)."""
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field


class PublicoDoAviso(BaseModel):
    """A REGRA de quem recebe: `tipo` é "associados", "permissao" ou "projeto". Listas vazias de situação e categoria querem dizer "todas" (o desligado nunca recebe)."""
    tipo: str
    situacoes: list[str] = Field(default_factory=list)
    categorias: list[str] = Field(default_factory=list)
    codigo_permissao: Optional[str] = None
    id_projeto: Optional[int] = None
    partes_do_projeto: list[str] = Field(default_factory=list)


class AvisoConferirPublico(BaseModel):
    publico: PublicoDoAviso


class AvisoPublicar(BaseModel):
    """`total_confirmado` é o número de pessoas que a tela mostrou e quem publica confirmou: o servidor recalcula o grupo e recusa se mudou (evita mandar para gente demais por engano)."""
    titulo: str
    texto: str
    categoria: str
    valido_ate: date
    exige_confirmacao: bool = False
    por_email: bool = False  # v6.2a: também por e-mail (quem publica escolhe)
    publico: PublicoDoAviso
    total_confirmado: int
    id_modelo: Optional[int] = None  # v6.2c: a versão do modelo usada (se usou)


class AvisoAgendar(AvisoPublicar):
    """v6.2c - o mesmo aviso, para publicar depois: `publicar_em` com fuso (o painel manda a hora de Belém convertida) ou em UTC."""
    publicar_em: datetime


class AvisoPreVisualizar(BaseModel):
    titulo: str
    texto: str
    publico: Optional[PublicoDoAviso] = None


class AvisoEnviarTeste(BaseModel):
    titulo: str
    texto: str
    exige_confirmacao: bool = False


class ModeloDeAvisoDados(BaseModel):
    nome: str
    titulo: str
    texto: str
    categoria: str
    exige_confirmacao: bool = False
    por_email: bool = False


class AgendamentoCancelar(BaseModel):
    motivo: str


class AvisoRetirar(BaseModel):
    motivo: str
