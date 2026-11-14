# Sorteador de inimigo secreto em círculo

Aplicativo local para criar **uma única roda** de participantes. Cada pessoa presenteia a próxima; a última presenteia a pessoa que começou. O resultado de cada participante vai apenas para seu próprio e-mail.

## Preparação

Requer Node.js 20 ou superior. Não há dependências para instalar.

1. Crie uma conta gratuita na [Brevo](https://www.brevo.com/), gere uma chave em **SMTP e API → Chaves de API** e cadastre e verifique um remetente.
2. Copie `.env.example` para `.env` e preencha `BREVO_API_KEY` e `BREVO_SENDER_EMAIL`. O endereço deve ser o remetente verificado na Brevo.
3. Execute `npm start` e abra <http://127.0.0.1:3000>.

A Brevo informa que o plano gratuito permite **300 e-mails por dia**. Se você usar um endereço gratuito como Gmail ou Outlook como remetente, a Brevo pode substituir o endereço exibido para melhorar a entrega. Um domínio próprio autenticado é recomendado, mas o serviço de envio tem plano gratuito.

## Como funciona

- Informe no mínimo 3 participantes, com nomes e e-mails únicos.
- Escolha opcionalmente quem começa a dar os presentes. Se deixar em branco, o início é aleatório.
- Clique em **Sortear e enviar e-mails**. A ordem é embaralhada com o gerador criptográfico do Node.js.
- O resultado fica salvo em `.data/` para retomar os envios pendentes sem mudar o sorteio. Essa pasta e o `.env` são ignorados pelo Git.
- A tela de acompanhamento mostra apenas o estado de cada envio, sem revelar quem cada pessoa tirou.

Se um envio ficar como **incerto**, confira o histórico de e-mails na Brevo antes de fazer outro sorteio. O aplicativo não o reenviará automaticamente, para evitar mensagens duplicadas.

O servidor escuta apenas em `127.0.0.1`. Não publique esta versão diretamente na internet: ela foi feita para o organizador executar no próprio computador.

## Testes

```sh
npm test
```

## Fontes sobre a Brevo

- [Limites do plano gratuito](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)
- [API de e-mails transacionais](https://developers.brevo.com/docs/send-a-transactional-email)
- [Requisitos para remetentes](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders)
