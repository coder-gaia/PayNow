# ADR-0014: escopo PCI-DSS SAQ-A por desenho

- **Status:** Aceita
- **Data:** 2026-09-01
- **Fase:** 05
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

Um sistema que cobra cartão entra no escopo do PCI-DSS. O tamanho desse escopo
não é dado pelo volume de transações: é dado por **o que o sistema toca**.

- Se o sistema **armazena** número de cartão, o escopo é SAQ-D: centenas de
  requisitos, varredura trimestral, segmentação de rede, revisão de código
  formal.
- Se ele apenas **transmite**, ainda é SAQ-D ou SAQ-A-EP, conforme o caminho.
- Se ele **nunca vê o cartão**, e a captura acontece inteiramente no provedor,
  o escopo cai para SAQ-A: um punhado de requisitos, quase todos sobre
  fornecedores e políticas.

A diferença entre SAQ-A e SAQ-D é a diferença entre um projeto viável e um
projeto que precisa de um time de conformidade. E ela é decidida por uma única
escolha de arquitetura, tomada cedo, quase de graça.

Tomada tarde, custa uma reescrita: quando o número de cartão já circula pelo
sistema, tirá-lo exige achar todo lugar por onde ele passou, incluindo log,
backup, fila e dump de erro.

## Decisão

**O Paynow nunca vê, transmite ou armazena número de cartão.** O escopo é
SAQ-A, e isso é uma propriedade do desenho, não uma promessa operacional.

O que o sistema guarda é um **token opaco** emitido pelo provedor, mais bandeira
e últimos quatro dígitos para exibição. O token só tem sentido para quem o
emitiu; vazado, não compra nada em lugar nenhum.

A captura do cartão acontece no navegador do cliente, contra o provedor, sem
passar pelo servidor do Paynow. O que chega aqui é o resultado dessa captura.

Três reforços tornam a decisão difícil de furar por acidente:

1. **A porta de gateway não tem onde colocar um cartão.** `PaymentMethodRef`
   aceita token, bandeira e quatro dígitos, e nada mais. Passar um cartão exigiria
   alterar o contrato, que é uma mudança visível em revisão.
2. **A rota que vincula meio de pagamento recusa o que parecer cartão.** Uma
   sequência de doze a dezenove dígitos é rejeitada com mensagem explícita. A
   defesa mais barata contra dado sensível entrar no sistema é ele não passar
   pela porta.
3. **A coluna se chama `payment_method_token`.** Nome de coluna é documentação
   que ninguém pode ignorar, e `card_number` nunca vai existir por descuido.

## Consequências

### Positivas

- O questionário de conformidade que se aplica é o menor que existe.
- Um vazamento do banco não expõe cartão de ninguém, porque não há cartão.
- Log, backup e dump de erro ficam fora do escopo automaticamente, porque não há
  o que redigir deles.
- A decisão custa quase nada agora e economiza uma reescrita depois.

### Negativas

- A captura do cartão fica presa ao componente de front-end do provedor, com o
  espaço de customização que ele permitir.
- Trocar de provedor exige **retokenizar**: os tokens antigos não valem no
  provedor novo. Provedores sérios oferecem migração assistida, mas é um projeto,
  e não uma troca de variável de ambiente.
- Não dá para implementar roteamento entre adquirentes com o cartão em mãos,
  que é uma otimização de aprovação usada por operações grandes. Sair disso
  significaria sair do SAQ-A, e é uma decisão que se toma com um time de
  conformidade, não em uma ADR.

## Alternativas consideradas

### Armazenar o cartão criptografado

Rejeitada. Criptografia não reduz escopo: cartão criptografado continua sendo
dado de cartão para o PCI-DSS, e o sistema passa a precisar de gestão de chave,
rotação e HSM. Paga-se o custo alto e não se compra a redução de escopo.

### Deixar o escopo para depois

Rejeitada, e é a alternativa contra a qual esta ADR existe. É a escolha padrão
de quem não decide, e é a única cujo custo cresce sozinho: cada semana em que o
cartão circula aumenta o número de lugares de onde ele precisa ser removido.

### Confiar em política em vez de desenho

"Não guarde cartão" como regra escrita, sem nada no código que a garanta.
Rejeitada pelo mesmo motivo da ADR-0005 sobre invariantes contábeis: uma regra
que só vale no caminho feliz não é garantia, é convenção. A validação na rota e
o formato da porta são o que transformam a política em propriedade.

## Gatilho de revisão

Reabrir se houver decisão de negócio de rotear entre adquirentes ou de oferecer
captura de cartão com interface própria, que são os dois motivos legítimos de
sair do SAQ-A. Qualquer um dos dois exige assessoria de conformidade antes de
uma linha de código.

Revisar também quando o `StripeGateway` da ADR-0011 entrar, para confirmar que o
fluxo de captura escolhido é o que mantém o escopo, e não uma variante que o
amplia sem avisar.
