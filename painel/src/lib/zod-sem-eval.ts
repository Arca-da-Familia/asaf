import { z } from 'zod'

// v7.3b - a política de conteúdo do painel proíbe `eval` (script-src sem 'unsafe-eval'). O zod 4 tenta `new Function` para descobrir se pode compilar
// os esquemas e, sob a política, o navegador registra essa tentativa como bloqueio (o robô da homologação a viu em todas as telas), mesmo o zod funcionando
// sem ela. Com `jitless` ele nem tenta: valida do jeito comum, sem eval (o caminho que a documentação do zod indica para quem usa CSP).
z.config({ jitless: true })
