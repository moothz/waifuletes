-- 1. Corrigir Jane Doe (Zenless Zone Zero)
UPDATE "characters"
SET "name" = 'Jane Doe',
    "series" = 'Zenless Zone Zero',
    "baseRarity" = 'EPIC',
    "description" = 'Agente Anomalia Física de Classe S da facção Investigação Criminal de Segurança Pública (NEPS) em Zenless Zone Zero.'
WHERE "id" = 'jane-doe';

-- 2. Corrigir John Doe (Batman: The Telltale Series)
UPDATE "characters"
SET "name" = 'John Doe (Joker)',
    "description" = 'Paciente do Asilo Arkham que assume a identidade do Coringa em Batman: The Telltale Series.'
WHERE "id" = 'john-doe-batman-the-telltale-series';

-- 3. Corrigir Chaser John Doe (Yumekui Merry)
UPDATE "characters"
SET "name" = 'Chaser John Doe',
    "description" = 'Demônio dos Sonhos com máscara de gato (Chaser) em Yumekui Merry.'
WHERE "id" = 'john-doe-ym';

-- 4. Corrigir John Doe (Roadkill - Twisted Metal)
UPDATE "characters"
SET "name" = 'John Doe (Roadkill)',
    "description" = 'Motorista amnésico do Roadkill em Twisted Metal: Black.'
WHERE "id" = 'john-doe-tm';

-- 5. Limpar nome de Jane Doe (Forsaken)
UPDATE "characters"
SET "name" = 'Jane Doe'
WHERE "id" = 'jane-doe-fk';

-- 6. Remover placeholders / duplicatas obscuras sem interações
DELETE FROM "characters"
WHERE "id" IN (
    'john-doe-jd',
    'john-doe-mmmd',
    'john-doe-halo',
    'jane-doe-carneades',
    'jane-doe-di',
    'jane-doe-cfc',
    'jane-doe-dc',
    'jane-doe-the-witch'
);
