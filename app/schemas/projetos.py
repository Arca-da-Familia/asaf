from pydantic import BaseModel
from datetime import datetime

class ProjetoCriar(BaseModel):
    nome_projeto: str
    tipo_foco: str
    necessita_alvara_bombeiros: bool
    data_inicio: datetime
    data_fim_prevista: datetime

class VoluntarioAlocar(BaseModel):
    id_projeto: int
    id_associado: int
    funcao_desempenhada: str
