CRÔNICA DE SANGUE — atualização visual

Arquivos incluídos:
- index.html: estrutura original preservada, com o CSS movido para arquivo externo.
- css/style.css: estilo original + acabamento visual medieval Skyrim.
- server.js: servidor original com suporte para servir arquivos CSS e imagens estáticas permitidas.
- package.json: metadados e comando npm start.

COMO APLICAR COM SEGURANÇA
1. Faça uma cópia de segurança da pasta atual do projeto.
2. Substitua o index.html e o server.js pelos arquivos desta atualização.
3. Crie a pasta css, se ainda não existir, e coloque style.css dentro dela.
4. Não substitua a pasta data nem o arquivo data/state.json. Eles contêm os dados atuais do torneio.
5. Preserve data/admins.json se já existir; ele guarda o cadastro do administrador.
6. No terminal, dentro da pasta do projeto, execute: npm start
7. Abra http://localhost:8770 e teste também http://localhost:8770/admin.

A alteração de CSS não modifica a lógica de apostas, as regras percentuais, a chave ou os dados existentes.
