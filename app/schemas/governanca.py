from pydantic import BaseModel
from datetime import datetime

class AssembleiaCriar(BaseModel):
    titulo_edital: str
    pauta_principal: str
    data_realizacao: datetime

class VotoRegistrar(BaseModel):
    id_assembleia: int
    id_associado: int
    decisao: str
    tipo_assinatura: str
    protocolo_autenticacao: str
