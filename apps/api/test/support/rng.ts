/**
 * Aleatoriedade determinística.
 *
 * Uma suíte adversarial que usa `Math.random()` produz anedotas: quando ela
 * falha no CI, ninguém consegue reproduzir a falha, e o resultado prático é que
 * a falha é reexecutada até passar. Com semente, toda execução é replicável por
 * um número, e o número aparece na mensagem de erro.
 *
 * O algoritmo é o mulberry32. Escolhido por ser curto o bastante para caber
 * aqui e ser lido, e por ter distribuição boa o suficiente para sortear ordem
 * de eventos. Não serve para criptografia, e não é para isso que está aqui.
 */
export interface Rng {
  /** Inteiro em [0, limite). */
  inteiro(limite: number): number;
  /** Um item da lista. Lança se a lista estiver vazia, em vez de devolver undefined. */
  escolher<T>(lista: readonly T[]): T;
  /** Uma cópia embaralhada, por Fisher-Yates. */
  embaralhar<T>(lista: readonly T[]): T[];
  /** Verdadeiro com a probabilidade dada, entre 0 e 1. */
  talvez(probabilidade: number): boolean;
  /** A semente que gerou esta sequência, para a mensagem de falha. */
  readonly semente: number;
}

export function criarRng(semente: number): Rng {
  let estado = semente >>> 0;

  const proximo = (): number => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const inteiro = (limite: number): number => Math.floor(proximo() * limite);

  return {
    semente,
    inteiro,

    escolher<T>(lista: readonly T[]): T {
      if (lista.length === 0) {
        throw new Error('Não há de onde escolher: a lista está vazia.');
      }

      return lista[inteiro(lista.length)] as T;
    },

    embaralhar<T>(lista: readonly T[]): T[] {
      const copia = [...lista];

      for (let i = copia.length - 1; i > 0; i -= 1) {
        const j = inteiro(i + 1);
        [copia[i], copia[j]] = [copia[j] as T, copia[i] as T];
      }

      return copia;
    },

    talvez(probabilidade: number): boolean {
      return proximo() < probabilidade;
    },
  };
}

/**
 * A semente da execução.
 *
 * Sem `SEED` no ambiente, cada execução sorteia a sua, o que é o
 * comportamento desejado: a suíte precisa explorar cenários novos a cada build,
 * ou vira um teste fixo com nome pomposo. Com `SEED`, ela repete exatamente uma
 * execução anterior, que é como uma falha do CI é investigada.
 */
export function sementeDaExecucao(): number {
  const doAmbiente = process.env['SEED'];

  if (doAmbiente !== undefined && doAmbiente !== '') {
    const lida = Number.parseInt(doAmbiente, 10);

    if (!Number.isFinite(lida)) {
      throw new Error(`SEED precisa ser um número inteiro, e veio "${doAmbiente}".`);
    }

    return lida >>> 0;
  }

  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}
