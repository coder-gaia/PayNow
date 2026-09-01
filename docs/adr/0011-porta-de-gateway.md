# ADR-0011: porta de gateway com implementação falsa como padrão

- **Status:** Aceita
- **Data:** 2026-09-01
- **Fase:** 05
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

Cobrar exige falar com um provedor de pagamento. A pergunta não é qual escolher,
é onde essa escolha aparece no código.

Um sistema que chama o SDK do provedor de dentro do serviço de cobrança fica
preso a ele de um jeito que não aparece em nenhum diagrama: o formato do erro,
o vocabulário de status, o comportamento de idempotência e a semântica de
timeout vazam para dentro da regra de negócio. Trocar de provedor deixa de ser
uma decisão de infraestrutura e vira reescrita.

Há um problema mais imediato, e é o que decidiu o desenho. **O comportamento
interessante de um gateway é o que ele faz quando dá errado**: recusa
temporária, recusa definitiva, e o caso que importa mais, o timeout, em que o
provedor recebeu, talvez cobrou, e não respondeu. Provedores de verdade não
produzem essas falhas sob demanda. O ambiente de teste do Stripe tem cartões
que recusam, mas não tem um botão de "não responda desta vez".

Sem conseguir provocar a falha, ela não é verificada. E não verificada, ela é
descoberta em produção, com dinheiro real.

## Decisão

O sistema conhece uma **porta**, `PaymentGateway`, e nunca um provedor.

A porta vive em `platform` porque o contrato pertence aos dois lados: o módulo
de cobrança a consome, a implementação a satisfaz. Ela é deliberadamente
pequena: cobrar, estornar. Um gateway real tem dezenas de capacidades, e trazer
todas para a porta faria trocar de provedor exigir reescrever a própria porta.

O **gateway falso é o padrão**, e não um dublê de teste. Ele vive no código de
produção porque é o gateway do ambiente de demonstração e porque a suíte
adversarial da fase 07 vai dirigi-lo. Ele é programável por cenário: passar,
recusar de forma temporária, recusar de forma definitiva, falhar N vezes e
então passar, ou não responder.

Três detalhes do contrato carregam decisão de projeto:

**Recusa e incerteza são coisas diferentes.** Devolver `failed` significa "sei o
que aconteceu, foi recusa". Lançar `GatewayUnavailableError` significa "não sei
o que aconteceu". Quem chama trata os dois de formas opostas: recusa é decisão
do emissor e vai para a recuperação; incerteza exige que nada seja lançado no
razão, porque afirmar que o pagamento falhou seria tão inventado quanto afirmar
que passou.

**A recusa diz se vale insistir.** `retriable` separa "não tem saldo hoje" de
"este cartão foi cancelado". Insistir no segundo caso queima a relação com o
cliente e ainda conta como tentativa fracassada para o adquirente, o que se
paga em taxa.

**A chave de idempotência é do chamador.** Ela é derivada da fatura e da
tentativa, nunca aleatória, e o gateway falso a implementa de verdade: a mesma
chave devolve o mesmo resultado. Simular a idempotência faria o teste de
cobrança em dobro passar por acidente, provando nada.

## Consequências

### Positivas

- O caso do timeout é verificado, e é verificado contra o mesmo código que roda
  em produção. O teste que importa mais é o que só existe por causa desta
  decisão.
- A demonstração cobra de verdade, sem chave de provedor nenhuma e sem rede.
  Quem clona o repositório vê o sistema funcionar inteiro.
- Trocar o falso pelo Stripe é editar um módulo de composição.
- O domínio fala de cobrança, e não de `PaymentIntent`.

### Negativas

- A porta é uma tradução, e toda tradução perde. Capacidades específicas de um
  provedor, como 3-D Secure ou parcelamento, não cabem no contrato atual e vão
  exigir estendê-lo.
- O gateway falso é código de produção que nunca cobra ninguém, e precisa ser
  mantido com o mesmo cuidado do resto.
- Passar nos testes contra o falso **não** prova que a integração real funciona.
  O falso verifica o comportamento do Paynow diante de cada desfecho, e não que
  o Stripe produza aqueles desfechos. Essa segunda garantia exige teste de
  contrato contra o ambiente de teste do provedor, que entra junto com o Stripe.

## Alternativas consideradas

### Chamar o SDK do provedor direto do serviço de cobrança

Rejeitada. É a alternativa que não permite verificar o timeout, que é o
comportamento cuja ausência de teste custa mais caro. Além disso amarra o
vocabulário do domínio ao do provedor.

### Porta com dublê só em teste, e provedor real como padrão

Rejeitada por duas razões. A primeira é que um dublê que só existe em teste
tende a divergir do comportamento real sem que ninguém perceba, porque nada
mais o exercita. A segunda é que a demonstração deixaria de funcionar sem
credencial de provedor, e um projeto que só roda com chave de terceiro perde
metade do valor de ser clonável.

### Adotar o Stripe direto e usar o ambiente de teste dele para tudo

Rejeitada nesta fase. O ambiente de teste do Stripe é excelente para verificar a
integração, e ruim para verificar o Paynow: ele não provoca timeout sob demanda,
depende de rede, e amarra a suíte à disponibilidade de um terceiro. O lugar dele
é como segundo verificador, e não como único.

## Gatilho de revisão

Implementar `StripeGateway` quando houver intenção de cobrar dinheiro real, o
que exige antes: teste de contrato contra o ambiente de teste do provedor,
tratamento de webhook de confirmação assíncrona (fase 06), e a decisão sobre
3-D Secure, que provavelmente exige um terceiro desfecho na porta, o de
"requer ação do cliente".
