// v9.4 (achado do robô dos cabeçalhos de segurança, 12/11): a política de conteúdo do painel proíbe `eval`, e o zod tenta `Function('')` para saber se
// pode compilar os esquemas — o navegador registra a tentativa como bloqueio. O `z.config({ jitless: true })` de `zod-sem-eval.ts` evitava isso, mas só
// valia se rodasse ANTES do primeiro esquema; depois da atualização do Vite (lote 17), o pedaço com os esquemas passou a rodar antes dele. Agora todo
// `import 'zod'` do painel chega aqui (atalho em vite.config.ts e vitest.config.ts): o modo sem eval é ligado antes de qualquer esquema existir, qualquer
// que seja a ordem em que a montagem junta os pedaços. Aqui o zod vem por `zod/v4` (o mesmo código), que o atalho não desvia.
import { config } from 'zod/v4'

config({ jitless: true })

export * from 'zod/v4'
export { z, z as default } from 'zod/v4'
