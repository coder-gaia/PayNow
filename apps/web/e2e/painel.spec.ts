import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
  addPerson,
  createApiKey,
  createPlan,
  createWorkspace,
  login,
  memberRow,
  navLink,
  notice,
  PASSWORD,
  startSubscription,
  toast,
} from './support';

/**
 * Fluxo do painel com navegador de verdade.
 *
 * Cada teste monta a própria organização pela API antes de abrir a interface,
 * então não há estado compartilhado entre eles e os dados de demonstração
 * ficam intactos. Ver o comentário em support.ts.
 */

test.describe('autenticação', () => {
  test('entra e sai', async ({ page, request }) => {
    const workspace = await createWorkspace(request);

    await login(page, workspace.owner.email);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/entrar/);
  });

  test('recusa senha errada sem dizer se o email existe', async ({ page, request }) => {
    const workspace = await createWorkspace(request);

    await page.goto('/entrar');
    await page.getByLabel('Email').fill(workspace.owner.email);
    await page.getByLabel('Senha', { exact: true }).fill('senha errada mas longa');
    await page.getByRole('button', { name: 'Entrar' }).click();

    // A mensagem vem da API e é a mesma de email inexistente. Antes o painel
    // mostrava um genérico de sessão expirada, porque tratava todo 401 igual.
    await expect(page.getByText('Email ou senha inválidos.')).toBeVisible();
  });

  test('o olho revela e esconde a senha', async ({ page }) => {
    await page.goto('/entrar');

    const senha = page.getByLabel('Senha', { exact: true });
    await senha.fill(PASSWORD);
    await expect(senha).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Mostrar senha' }).click();
    await expect(senha).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: 'Ocultar senha' }).click();
    await expect(senha).toHaveAttribute('type', 'password');
  });

  test('o campo de senha não herda o nome do botão do olho', async ({ page }) => {
    await page.goto('/entrar');

    // Regressao de acessibilidade: com o botão dentro do rotulo, o nome
    // acessivel do campo virava "Senha Mostrar senha".
    await expect(page.getByRole('textbox', { name: 'Senha', exact: true })).toBeVisible();
  });

  test('sem sessão, o painel manda para o login', async ({ page }) => {
    await page.goto('/painel/chaves');
    await expect(page).toHaveURL(/\/entrar/);
  });
});

/**
 * Sessão que morre no servidor.
 *
 * O caso apareceu de verdade: depois de recriar o banco de desenvolvimento, o
 * token no navegador continuava criptograficamente válido, mas a conta dele
 * não existia mais. A API respondia 404 e o painel quebrava com um stack trace
 * na cara de quem estava usando.
 *
 * A correção tem dois lados. A API passou a recusar com 401 o token de uma
 * conta que sumiu, porque o problema é a credencial e não o recurso. E o
 * painel passou a sair por /sair, que limpa os cookies antes de mandar para o
 * login: um Server Component não grava cookie, então redirecionar direto
 * deixaria o refresh token velho no navegador e o middleware devolveria a
 * pessoa ao painel, em laço.
 *
 * Os testes daqui cobrem a saída. O lado da API, que é onde a conta apagada
 * deixa de autenticar, é coberto por auth.e2e-spec.ts, que apaga o usuário de
 * verdade antes de reapresentar o token. Apagar uma conta não tem rota, então
 * não dá para reproduzir isso pelo navegador.
 */
test.describe('sessão encerrada', () => {
  test('sair limpa os cookies e leva ao login', async ({ page, request }) => {
    const workspace = await createWorkspace(request, 'saida');
    await login(page, workspace.owner.email);

    await page.goto('/sair?motivo=expirada');

    await expect(page).toHaveURL(/\/entrar/);
    await expect(page.getByText(/A sessão expirou ou foi encerrada/)).toBeVisible();

    const cookies = await page.context().cookies();
    const daSessao = cookies.filter((cookie) => cookie.name.startsWith('paynow_'));
    expect(daSessao.filter((cookie) => cookie.value !== '')).toEqual([]);
  });

  test('com a sessão limpa, o painel manda para o login em vez de quebrar', async ({
    page,
    request,
  }) => {
    const workspace = await createWorkspace(request, 'quebrada');
    await login(page, workspace.owner.email);

    await page.context().clearCookies();
    await page.goto('/painel/ledger');

    await expect(page).toHaveURL(/\/entrar/);
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });
});

test.describe('membros', () => {
  test('papel recusado pelo servidor volta ao valor real', async ({ page, request }) => {
    const workspace = await createWorkspace(request);

    await login(page, workspace.owner.email);
    await navLink(page, 'Membros').click();

    const papel = memberRow(page, workspace.owner.name).getByLabel(
      `Papel de ${workspace.owner.name}`,
    );
    await expect(papel).toHaveValue('OWNER');

    // Rebaixar o único OWNER travaria a organização, e o servidor recusa. A
    // tela não pode continuar mostrando ADMIN depois disso.
    await papel.selectOption('ADMIN');

    await expect(toast(page, 'ao menos um OWNER')).toBeVisible();
    await expect(papel).toHaveValue('OWNER');

    await page.reload();
    await expect(memberRow(page, workspace.owner.name).getByLabel(/Papel de/)).toHaveValue('OWNER');
  });

  test('mudança aceita persiste e avisa', async ({ page, request }) => {
    const workspace = await createWorkspace(request);
    const pessoa = await addPerson(request, workspace, 'MEMBER');

    await login(page, workspace.owner.email);
    await navLink(page, 'Membros').click();

    const papel = memberRow(page, pessoa.name).getByLabel(`Papel de ${pessoa.name}`);
    await expect(papel).toHaveValue('MEMBER');

    await papel.selectOption('READONLY');
    await expect(notice(page, 'READONLY')).toBeVisible();

    await page.reload();
    await expect(memberRow(page, pessoa.name).getByLabel(/Papel de/)).toHaveValue('READONLY');
  });

  test('remoção pede confirmação e cancelar não remove', async ({ page, request }) => {
    const workspace = await createWorkspace(request);
    const pessoa = await addPerson(request, workspace, 'ADMIN');

    await login(page, workspace.owner.email);
    await navLink(page, 'Membros').click();

    await memberRow(page, pessoa.name).getByRole('button', { name: 'Remover' }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText(`Remover ${pessoa.name}`);

    await dialogo.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogo).toBeHidden();
    await expect(memberRow(page, pessoa.name)).toBeVisible();
  });

  test('remoção confirmada tira a pessoa da lista', async ({ page, request }) => {
    const workspace = await createWorkspace(request);
    const pessoa = await addPerson(request, workspace, 'MEMBER');

    await login(page, workspace.owner.email);
    await navLink(page, 'Membros').click();

    await memberRow(page, pessoa.name).getByRole('button', { name: 'Remover' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remover' }).click();

    await expect(notice(page, 'removida')).toBeVisible();
    await expect(memberRow(page, pessoa.name)).toHaveCount(0);
  });
});

test.describe('chaves de api', () => {
  test('cria a chave e revela o segredo uma única vez', async ({ page, request }) => {
    const workspace = await createWorkspace(request);
    const nome = 'Servidor de teste';

    await login(page, workspace.owner.email);
    await navLink(page, 'Chaves de API').click();

    await page.getByLabel('Nome').fill(nome);
    await page.getByRole('button', { name: 'Criar chave' }).click();

    const aviso = notice(page, 'Chave criada');
    await expect(aviso).toBeVisible();
    // O segredo e base64url, que inclui hifen: `\w` sozinho não cobre.
    await expect(aviso.getByText(/^sk_test_[\w-]{30,}$/)).toBeVisible();

    // Depois de recarregar sobra o prefixo, porque o servidor guarda o hash.
    await page.reload();
    await expect(notice(page, 'Chave criada')).toBeHidden();
    await expect(page.getByRole('row').filter({ hasText: nome })).toBeVisible();
  });

  /**
   * Regressao. A confirmação era aguardada dentro de `startTransition`, o que
   * prendia a transição esperando um clique humano e deixava o botão travado
   * em "Revogando..." para sempre, sem revogar nada.
   */
  test('revoga a chave depois de confirmar no diálogo', async ({ page, request }) => {
    const workspace = await createWorkspace(request);
    const nome = 'Chave descartável';
    await createApiKey(request, workspace, nome);

    await login(page, workspace.owner.email);
    await navLink(page, 'Chaves de API').click();

    const linha = page.getByRole('row').filter({ hasText: nome });
    await linha.getByRole('button', { name: 'Revogar' }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText(`Revogar "${nome}"`);
    await dialogo.getByRole('button', { name: 'Revogar' }).click();

    await expect(dialogo).toBeHidden();
    await expect(notice(page, 'foi revogada')).toBeVisible();
    await expect(linha.getByText('REVOGADA')).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole('row').filter({ hasText: nome }).getByText('REVOGADA'),
    ).toBeVisible();
  });

  test('cancelar o diálogo não revoga', async ({ page, request }) => {
    const workspace = await createWorkspace(request);
    const nome = 'Chave preservada';
    await createApiKey(request, workspace, nome);

    await login(page, workspace.owner.email);
    await navLink(page, 'Chaves de API').click();

    const linha = page.getByRole('row').filter({ hasText: nome });
    await linha.getByRole('button', { name: 'Revogar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

    await expect(linha.getByRole('button', { name: 'Revogar' })).toBeEnabled();
    await expect(linha.getByText('REVOGADA')).toHaveCount(0);
  });
});

test.describe('organização ativa', () => {
  test('sem escolha, não há seletor', async ({ page, request }) => {
    const workspace = await createWorkspace(request);
    await login(page, workspace.owner.email);

    // Com uma organização só, um seletor de um item seria ruído.
    await expect(page.getByLabel('Organização ativa')).toHaveCount(0);
  });

  /**
   * Regressao. `POST /auth/register` sempre cria uma organização, então quem
   * era convidado para outra participava de duas e o painel abria sempre a
   * primeira. Sem seletor, a segunda era inalcancavel pela interface.
   */
  test('quem participa de duas consegue trocar e a escolha permanece', async ({
    page,
    request,
  }) => {
    const anfitria = await createWorkspace(request, 'anfitria');
    const convidada = await addPerson(request, anfitria, 'ADMIN');

    await login(page, convidada.email);

    const seletor = page.getByLabel('Organização ativa');
    await expect(seletor).toBeVisible();

    // A própria organização e a primeira, então é a que abre.
    await expect(seletor).not.toHaveValue(anfitria.organizationId);

    await seletor.selectOption(anfitria.organizationId);
    await expect(seletor).toHaveValue(anfitria.organizationId);

    // A escolha sobrevive a navegação e ao recarregamento.
    await navLink(page, 'Membros').click();
    await expect(memberRow(page, anfitria.owner.name)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Organização ativa')).toHaveValue(anfitria.organizationId);
  });

  test('cookie apontando para organização alheia cai na primeira', async ({
    page,
    request,
    context,
  }) => {
    const propria = await createWorkspace(request, 'propria');
    const alheia = await createWorkspace(request, 'alheia');

    await login(page, propria.owner.email);

    // Cookie forjado para uma organização da qual a pessoa não participa.
    await context.addCookies([
      {
        name: 'paynow_org',
        value: alheia.organizationId,
        domain: 'localhost',
        path: '/',
      },
    ]);

    await page.goto('/painel/membros');

    // Cai na organização real, e não na do cookie.
    await expect(memberRow(page, propria.owner.name)).toBeVisible();
    await expect(memberRow(page, alheia.owner.name)).toHaveCount(0);
  });
});

/**
 * Estes dois usam as contas de demonstracao, e não uma organização criada na
 * hora, por uma limitacao que o painel ainda tem: `/auth/register` sempre cria
 * uma organização para quem se cadastra, então alguém convidado participa de
 * duas, e o painel abre sempre a primeira, que é a própria. Sem seletor de
 * organização não há como chegar na outra pela interface.
 *
 * As contas do seed nascem sem organização própria, então servem. Como os dois
 * testes apenas leem, não sujam os dados de demonstracao.
 */
test.describe('restrições por papel', () => {
  const MEMBER_DEMO = 'carla@livraria-aurora.test';
  const SENHA_DEMO = 'paynow-demo-2026';

  const entrarComoMembroDemo = async (page: Page): Promise<void> => {
    await page.goto('/entrar');
    await page.getByLabel('Email').fill(MEMBER_DEMO);
    await page.getByLabel('Senha', { exact: true }).fill(SENHA_DEMO);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/painel$/);
  };

  test('MEMBER não administra chaves', async ({ page }) => {
    await entrarComoMembroDemo(page);

    await page.goto('/painel/chaves');
    await expect(page.getByText(/administradas por OWNER e ADMIN/)).toBeVisible();
  });

  test('MEMBER vê a lista de membros em modo leitura', async ({ page }) => {
    await entrarComoMembroDemo(page);

    await page.goto('/painel/membros');
    await expect(page.getByText(/somente leitura/)).toBeVisible();
    await expect(page.getByLabel(/Papel de/)).toHaveCount(0);
  });
});

test.describe('razão', () => {
  test('mostra o balancete somando zero e afirma a integridade', async ({ page }) => {
    // Usa a organização de demonstração, que o seed carrega com os cinco
    // lançamentos de referência de docs/plano-de-contas.md. Criar um razão na
    // hora exigiria uma rota de escrita, e o ledger não tem uma de propósito:
    // lançamento nasce de evento de domínio, nunca de chamada HTTP avulsa.
    await page.goto('/entrar');
    await page.getByLabel('Email').fill('ana@livraria-aurora.test');
    await page.getByLabel('Senha', { exact: true }).fill('paynow-demo-2026');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/painel$/);

    await navLink(page, 'Razão').click();
    await expect(page).toHaveURL(/\/painel\/ledger$/);

    await expect(notice(page, 'Razão íntegro')).toBeVisible();

    // O balancete traz o plano de contas inteiro, e a soma tem de fechar. A
    // linha é procurada pelo nome da conta, e não pelo código: o código é a
    // identidade para quem integra e vive no title, não no texto da célula.
    // A busca e escopada ao painel do balancete: o nome da conta agora aparece
    // tambem nas linhas de cada lancamento, que e justamente o ponto.
    const painel = page.locator('section').filter({ hasText: 'Balancete' }).first();
    const balancete = painel.getByRole('row').filter({ hasText: 'Contas a receber' });
    await expect(balancete).toBeVisible();
    await expect(balancete).toContainText('faturas emitidas e ainda não pagas');
    await expect(balancete.getByTitle('customer:receivable')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Soma' }).getByText('0,00')).toBeVisible();

    // E os lançamentos carregam o evento de domínio que os originou, com nome
    // legível na tela e a identidade técnica no title: o tipo do evento e a
    // chave de idempotência continuam alcançáveis sem poluir a leitura.
    const lancamento = page.getByRole('listitem').filter({ hasText: 'Pagamento confirmado' });
    await expect(lancamento).toBeVisible();
    await expect(lancamento.getByTitle(/payment\.succeeded/)).toHaveCount(1);

    // As linhas são apresentadas como partida dobrada de verdade, em colunas
    // de débito e crédito, e com o nome da conta e não só o código. Valor com
    // sinal fazia a mesma conta aparecer duas vezes parecendo contraditória.
    await expect(lancamento.getByRole('columnheader', { name: 'Débito' })).toBeVisible();
    await expect(lancamento.getByRole('columnheader', { name: 'Crédito' })).toBeVisible();
    await expect(
      lancamento.getByRole('rowheader', { name: 'Em liquidação no gateway' }),
    ).toBeVisible();
  });
});

test.describe('assinaturas', () => {
  test('troca de plano mostra o rateio e escreve no razão', async ({ page, request }) => {
    const workspace = await createWorkspace(request, 'assinaturas');
    const basico = await createPlan(request, workspace, 'Plano Base', '2000');
    await createPlan(request, workspace, 'Plano Alto', '5000');
    const assinatura = await startSubscription(
      request,
      workspace,
      basico.priceId,
      'Livraria Teste',
    );

    await login(page, workspace.owner.email);
    await navLink(page, 'Assinaturas').click();
    await expect(page).toHaveURL(/\/painel\/assinaturas$/);

    const linha = page.getByRole('row').filter({ hasText: assinatura.customerName });
    await expect(linha).toContainText('Plano Base');
    await expect(linha).toContainText('Aguardando pagamento');

    // O rateio aparece por extenso no toast. Não basta a troca dar certo: quem
    // trocou de plano precisa ver o que aconteceu com o dinheiro do ciclo.
    const seletor = page.getByLabel(`Plano de ${assinatura.customerName}`);
    await seletor.selectOption({ label: 'Plano Alto · 50,00' });

    await expect(notice(page, 'Plano trocado')).toBeVisible();
    await expect(notice(page, 'Crédito de')).toContainText('dias restantes');
    await expect(linha).toContainText('Plano Alto');

    // E o lançamento correspondente chegou ao razão, no mesmo instante e sem
    // desbalancear nada. Esta é a razão de o barramento de eventos existir.
    await navLink(page, 'Razão').click();
    await expect(notice(page, 'Razão íntegro')).toBeVisible();
    await expect(page.getByText('Troca de plano').first()).toBeVisible();
  });

  test('cancelamento pede confirmação e pode ser desfeito', async ({ page, request }) => {
    const workspace = await createWorkspace(request, 'cancelamento');
    const plano = await createPlan(request, workspace, 'Plano Único', '3000');
    const assinatura = await startSubscription(request, workspace, plano.priceId, 'Padaria Teste');

    await login(page, workspace.owner.email);
    await page.goto('/painel/assinaturas');

    const linha = page.getByRole('row').filter({ hasText: assinatura.customerName });
    await linha.getByRole('button', { name: 'Cancelar' }).click();

    // Diálogo nativo, e não window.confirm: o texto precisa dizer o que vai
    // acontecer com o acesso, e um confirm do navegador não permite isso.
    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toContainText('continua com acesso até');
    await dialogo.getByRole('button', { name: 'Agendar cancelamento' }).click();

    await expect(notice(page, 'encerra em')).toBeVisible();
    await expect(linha).toContainText('encerra no fim do ciclo');

    // Cancelamento agendado é reversível, e o botão troca sozinho para dizer
    // isso. Quem cancelou por engano tem como voltar atrás antes do fim do
    // ciclo, que é justamente o motivo de o padrão não ser encerrar na hora.
    await linha.getByRole('button', { name: 'Retomar' }).click();
    await expect(notice(page, 'retomada')).toBeVisible();
    await expect(linha).not.toContainText('encerra no fim do ciclo');
  });

  /**
   * A carteira de demonstração.
   *
   * O teste confere que os quatro clientes do seed aparecem com estado, plano
   * e ciclo, e não que cada um está em um estado específico. A diferença é
   * proposital: a organização de demonstração existe para ser usada, e usá-la
   * muda o estado dela. Adiantar o relógio ativa quem estava em teste, o que é
   * o comportamento correto do sistema. Fixar o estado aqui faria o teste
   * acusar como defeito exatamente aquilo que a demonstração serve para
   * mostrar.
   */
  test('a carteira de demonstração mostra a máquina de estados', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel('Email').fill('ana@livraria-aurora.test');
    await page.getByLabel('Senha', { exact: true }).fill('paynow-demo-2026');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/painel$/);

    await navLink(page, 'Assinaturas').click();

    for (const cliente of ['Padaria Lua', 'Studio Vega', 'Bike Norte', 'Mercado Sul']) {
      const linha = page.getByRole('row').filter({ hasText: cliente });
      await expect(linha).toBeVisible();

      // Todo estado exibido vem da máquina de transições, então a pílula
      // sempre traz o nome técnico no title.
      await expect(linha.locator('[title]').first()).toBeVisible();
    }

    // Em atraso continua com acesso ao produto, porque cortar no primeiro dia
    // de atraso transformaria uma falha de cartão em cancelamento.
    await expect(page.getByRole('row').filter({ hasText: 'Mercado Sul' })).toContainText(
      'Em atraso',
    );
  });
});

test.describe('linha do tempo', () => {
  /**
   * O relógio virtual, exercitado pelo caminho que uma pessoa usa.
   *
   * Este é o teste que prova o segundo pilar de ponta a ponta: congelar,
   * adiantar e conferir que o ciclo de cobrança rodou de verdade, emitindo
   * fatura e escrevendo no razão.
   *
   * O plano tem um dia de teste de propósito. É o único caminho que leva uma
   * assinatura a ACTIVE sem passar por um pagamento, e pagamento é fase 05:
   * inventar uma rota para ativar à força faria o teste exercitar algo que a
   * aplicação não tem.
   */
  test('congela, adianta e a renovação chega ao razão', async ({ page, request }) => {
    const workspace = await createWorkspace(request, 'tempo');
    const plano = await createPlan(request, workspace, 'Plano Mensal', '5000', 1);
    await startSubscription(request, workspace, plano.priceId, 'Loja do Tempo', false);

    await login(page, workspace.owner.email);
    await navLink(page, 'Tempo').click();
    await expect(page).toHaveURL(/\/painel\/tempo$/);

    await expect(page.getByText('De parede', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Congelar o tempo' }).click();
    await expect(notice(page, 'Tempo congelado')).toBeVisible();
    await expect(page.getByText('Congelado', { exact: true })).toBeVisible();

    // O fim do teste ativa a assinatura e só então emite a primeira fatura:
    // período de teste não gera receita.
    await page.getByRole('button', { name: '+ 7 dias' }).click();
    await expect(notice(page, 'liquidada')).toBeVisible();
    await expect(page.getByText('teste encerrado, assinatura ativada')).toBeVisible();

    // O ciclo seguinte renova, e a fatura chega ao razão com ele íntegro.
    await page.getByRole('button', { name: '+ 1 mês' }).click();
    await expect(page.getByText('ciclo renovado')).toBeVisible();

    await navLink(page, 'Razão').click();
    await expect(notice(page, 'Razão íntegro')).toBeVisible();
    await expect(page.getByText('Fatura de Loja do Tempo').first()).toBeVisible();
  });

  /**
   * O teste que justifica o laço do ciclo.
   *
   * Um ciclo que processasse uma vez por chamada deixaria a assinatura com
   * períodos inteiros no passado e faturas faltando. Três meses de uma vez
   * têm de produzir mais de uma renovação.
   */
  test('um salto de três meses produz mais de uma renovação', async ({ page, request }) => {
    const workspace = await createWorkspace(request, 'tresmeses');
    const plano = await createPlan(request, workspace, 'Plano Trimestre', '1000', 1);
    await startSubscription(request, workspace, plano.priceId, 'Casa Trimestre', false);

    await login(page, workspace.owner.email);
    await page.goto('/painel/tempo');
    await page.getByRole('button', { name: 'Congelar o tempo' }).click();
    await expect(page.getByText('Congelado', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '+ 3 meses' }).click();
    await expect(notice(page, 'liquidada')).toBeVisible();

    // Uma ativação de fim de teste mais pelo menos duas renovações mensais.
    expect(await page.getByText('ciclo renovado').count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByText('teste encerrado, assinatura ativada')).toBeVisible();
  });

  test('sem o primeiro pagamento, o ciclo expira a assinatura', async ({ page, request }) => {
    const workspace = await createWorkspace(request, 'expira');
    const plano = await createPlan(request, workspace, 'Plano Sem Teste', '3000');
    await startSubscription(request, workspace, plano.priceId, 'Feira Sem Teste');

    await login(page, workspace.owner.email);
    await page.goto('/painel/tempo');
    await page.getByRole('button', { name: 'Congelar o tempo' }).click();
    await page.getByRole('button', { name: '+ 1 mês' }).click();

    await expect(page.getByText('expirada sem o primeiro pagamento')).toBeVisible();

    await navLink(page, 'Assinaturas').click();
    await expect(page.getByRole('row').filter({ hasText: 'Feira Sem Teste' })).toContainText(
      'Cancelada',
    );
  });

  test('voltar ao relógio de parede pede confirmação e não desfaz a história', async ({
    page,
    request,
  }) => {
    const workspace = await createWorkspace(request, 'volta');
    const plano = await createPlan(request, workspace, 'Plano Volta', '2500', 1);
    await startSubscription(request, workspace, plano.priceId, 'Bar da Volta', false);

    await login(page, workspace.owner.email);
    await page.goto('/painel/tempo');
    await page.getByRole('button', { name: 'Congelar o tempo' }).click();
    await page.getByRole('button', { name: '+ 7 dias' }).click();
    await expect(notice(page, 'liquidada')).toBeVisible();

    await page.getByRole('button', { name: 'Voltar ao relógio de parede' }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toContainText('append-only');
    await dialogo.getByRole('button', { name: 'Voltar ao tempo real' }).click();

    await expect(notice(page, 'De volta ao relógio de parede')).toBeVisible();
    await expect(page.getByText('De parede', { exact: true })).toBeVisible();

    // O lançamento criado durante a viagem continua lá.
    await navLink(page, 'Razão').click();
    await expect(page.getByText('Fatura de Bar da Volta').first()).toBeVisible();
  });
});

/**
 * Largura de celular.
 *
 * Um balancete é tabular por natureza, então em tela estreita ele rola em vez
 * de virar outra coisa. O que não pode acontecer é a tabela ser simplesmente
 * cortada: sem um ancestral que role, a coluna da direita fica inalcançável e
 * parece que o dado sumiu.
 *
 * O teste afirma as duas coisas: a página não rola na horizontal, e todo
 * elemento mais largo que a tela está dentro de algo que rola. Trocar a
 * rolagem do painel por `overflow: hidden` faz este teste falhar, que é
 * exatamente o defeito que ele existe para pegar.
 */
test.describe('tela pequena', () => {
  const PAGINAS = [
    '/painel',
    '/painel/assinaturas',
    '/painel/tempo',
    '/painel/ledger',
    '/painel/membros',
  ];

  for (const caminho of PAGINAS) {
    test(`${caminho} rola a tabela em vez de cortá-la em 375px`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 720 });

      await page.goto('/entrar');
      await page.getByLabel('Email').fill('ana@livraria-aurora.test');
      await page.getByLabel('Senha', { exact: true }).fill('paynow-demo-2026');
      await page.getByRole('button', { name: 'Entrar' }).click();
      await expect(page).toHaveURL(/\/painel$/);

      await page.goto(caminho);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const diagnostico = await page.evaluate(() => {
        const largura = document.documentElement.clientWidth;

        const rolavel = (el: Element | null): boolean => {
          for (let atual = el; atual !== null; atual = atual.parentElement) {
            const overflow = getComputedStyle(atual).overflowX;
            if (
              (overflow === 'auto' || overflow === 'scroll') &&
              atual.scrollWidth > atual.clientWidth
            ) {
              return true;
            }
          }
          return false;
        };

        return {
          paginaRola: document.documentElement.scrollWidth > largura,
          presas: [...document.querySelectorAll('table, img, pre')]
            .filter((el) => el.getBoundingClientRect().width > largura && !rolavel(el))
            .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)}`),
        };
      });

      expect(diagnostico.paginaRola, `${caminho} rola na horizontal`).toBe(false);
      expect(diagnostico.presas, `${caminho} tem conteúdo largo sem rolagem`).toEqual([]);
    });
  }
});
