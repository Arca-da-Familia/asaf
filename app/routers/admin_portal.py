from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.associados import Associado
from app.models.projetos import ProjetoEvento

router = APIRouter()

@router.get("/admin", response_class=HTMLResponse, summary="Mega Portal da Diretoria")
def painel_administrativo_master(db: Session = Depends(get_db)):
    # Buscando métricas rápidas no banco para o painel de instrumentos
    total_associados = db.query(Associado).count()
    projetos_pendentes = db.query(ProjetoEvento).filter(ProjetoEvento.status_liberacao == "Pendente de Vistoria").count()
    
    html_admin = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Central Administrativa - ASAF Enterprise</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 font-sans antialiased flex h-screen overflow-hidden">
        
        <!-- MEGA MENU ADMINISTRATIVO -->
        <aside class="w-80 bg-slate-900 text-white flex flex-col shadow-2xl z-10 overflow-y-auto">
            <div class="p-6 border-b border-slate-800 sticky top-0 bg-slate-900 z-20">
                <h2 class="text-2xl font-extrabold tracking-widest text-red-500">ASAF<span class="text-white">COMMAND</span></h2>
                <p class="text-xs text-slate-400 mt-1 uppercase tracking-widest">Governança Terceiro Setor</p>
            </div>
            
            <nav class="flex-1 px-4 py-6 space-y-1 text-sm font-medium overflow-y-auto pb-20">
                
                <!-- GABINETE E JURÍDICO -->
                <p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-2">Gabinete e Jurídico</p>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">1. Quórum Dinâmico</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">2. Auditoria e-Notariado</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">3. Livro de Atas Digital</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">4. Reformas Estatutárias</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">5. Conflito de Interesses</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">6. Vencimento de Mandatos</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">7. Reuniões (MS Teams)</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">8. Compliance CEBAS</a>

                <!-- TESOURARIA -->
                <p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Tesouraria e Finanças</p>
                <a href="/admin/titulos" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">9. Títulos (Lançar / Baixar)</a>
                <a href="/admin/livro-caixa" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">9.1 Livro-Caixa e Conciliação</a>
                <a href="/admin/plano-contas" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">9.2 Plano de Contas</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">10. Trava de Data Retroativa</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">11. D.R.E. Institucional</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">12. Calculadora de Depreciação</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">13. Mapa de Inadimplência</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">14. Conciliação Pix</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">15. Reembolsos (Voluntários)</a>
                <a href="/admin/fornecedores" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">16. Cadastro de Fornecedores</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">17. Exportação Balancetes</a>

                <!-- ENGENHARIA E INFRAESTRUTURA -->
                <p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Engenharia e Obras</p>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">18. Projetos de Fundação/Solos</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">19. Checklists NBR (Aço/Madeira)</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">20. Alvarás CBM-PA</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">21. Licenças Municipais</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">22. Zeladoria e Chamados</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">23. Agendamento de Espaços</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">24. Logística de Frota</a>

                <!-- OPERAÇÕES E EVENTOS (PDCA) -->
                <p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Projetos Sociais (PDCA)</p>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">25. Visão Kanban (Extensão)</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">26. Escalonamento Logístico</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">27. Check-in de Voluntários</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">28. Gerador de Certificados</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">29. Retrospectiva Pós-Evento</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">30. Entrada de Doações</a>

                <!-- ESTOQUE E PATRIMÔNIO -->
                <p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Patrimônio</p>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">31. Inventário Dinâmico</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">32. Cautela de Equipamentos</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">33. Registro de Avarias</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">34. Alertas de Reposição</a>

                <!-- SECRETARIA -->
<p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Secretaria Geral</p>
<a href="/admin/secretaria" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">35. Gestão de Fichas Master</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">36. Árvore Familiar</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">37. Radar de Habilidades</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">38. Ouvidoria</a>
                <a href="/admin/secretaria" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">39. Histórico de Cargos</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">40. Desligamentos</a>

                <!-- TI -->
                <p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Tecnologia da Informação</p>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">41. Perfis e Permissões</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">42. Logs de Auditoria do Sistema</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">43. Automação SharePoint</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">44. Editor de Templates Visuais</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">45. Backup de Banco de Dados</a>

            </nav>
        </aside>

        <!-- DASHBOARD CENTRAL -->
        <main class="flex-1 flex flex-col h-screen overflow-y-auto">
            <header class="h-20 bg-white shadow-sm flex items-center justify-between px-10 border-b border-slate-200">
                <h1 class="text-2xl font-bold text-slate-800">Mesa de Operações Diretiva</h1>
                <div class="flex items-center space-x-4">
                    <span class="px-4 py-1.5 bg-red-100 text-red-800 text-xs font-bold uppercase rounded-lg border border-red-200">
                        Acesso Nível: Diretoria Executiva
                    </span>
                    <a href="/" class="text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors">Voltar à Raiz</a>
                </div>
            </header>
            
            <div class="p-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                
                <!-- INDICADORES CRÍTICOS DE GOVERNANÇA -->
                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-blue-500">
                    <h3 class="text-slate-500 text-[11px] font-bold mb-1 uppercase tracking-wider">Base Social Ativa</h3>
                    <p class="text-3xl font-black text-slate-800">{total_associados}</p>
                    <p class="text-xs text-green-600 mt-2 font-semibold">Total de fichas master arroladas</p>
                </div>

                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-orange-500">
                    <h3 class="text-slate-500 text-[11px] font-bold mb-1 uppercase tracking-wider">Alvarás de Segurança CBM</h3>
                    <p class="text-3xl font-black text-slate-800">{projetos_pendentes}</p>
                    <p class="text-xs text-red-600 mt-2 font-semibold">Projetos PDCA com pendência técnica</p>
                </div>

                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-purple-500">
                    <h3 class="text-slate-500 text-[11px] font-bold mb-1 uppercase tracking-wider">Votações / Quórum</h3>
                    <p class="text-3xl font-black text-slate-800">AGE 02</p>
                    <p class="text-xs text-blue-600 mt-2 font-semibold">Aguardando certidões qualificadas</p>
                </div>

                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-emerald-500">
                    <h3 class="text-slate-500 text-[11px] font-bold mb-1 uppercase tracking-wider">Tesouraria</h3>
                    <p class="text-3xl font-black text-slate-800">Fechado</p>
                    <p class="text-xs text-emerald-600 mt-2 font-semibold">Nenhuma falha de data retroativa detectada</p>
                </div>

                <!-- GRADES DE AVISO LARGO -->
                <div class="lg:col-span-4 grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                    
                    <div class="bg-slate-900 rounded-2xl shadow-sm border border-slate-800 p-8 text-white">
                        <div class="flex items-center mb-4">
                            <span class="w-3 h-3 bg-red-500 rounded-full animate-pulse mr-3"></span>
                            <h3 class="font-bold text-red-400 uppercase tracking-wide text-sm">Trava de Engenharia Acionada</h3>
                        </div>
                        <p class="text-slate-300 text-sm mb-4 leading-relaxed">O projeto "Desfile Social" está bloqueado para avanço operacional. As licenças municipais de espaço público e os laudos de vistoria de estruturas não foram anexados na aba Operacional (PDCA).</p>
                        <button class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-lg text-sm transition-colors">
                            Forçar Resolução de Pendência
                        </button>
                    </div>

                    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                        <div class="flex items-center mb-4">
                            <span class="w-3 h-3 bg-blue-500 rounded-full mr-3"></span>
                            <h3 class="font-bold text-slate-800 uppercase tracking-wide text-sm">Status Jurídico</h3>
                        </div>
                        <p class="text-slate-600 text-sm mb-4 leading-relaxed">A parametrização do sistema está configurada para Governança do Terceiro Setor. Assinaturas eletrônicas padrão não serão computadas para o registro civil da nova ata estatutária.</p>
                        <button class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 px-6 rounded-lg text-sm transition-colors">
                            Auditar Protocolos ICP-Brasil
                        </button>
                    </div>

                </div>
            </div>
        </main>
    </body>
    </html>
    """
    return html_admin
# ==========================================
# APIs DE ATUALIZAÇÃO (MOTORES DO CRUD)
# ==========================================
