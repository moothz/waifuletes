-- O valor MARKET_TRADE foi adicionado ao enum KakeraReason no schema (637f077) sem migração.
-- Sem ele, toda troca com Zinthos nos classificados falha ao registrar a transação de kakera.
-- IF NOT EXISTS: bancos que já receberam o valor por outro caminho seguem intactos.
-- (O diff gerado também propunha remover os índices trigram e defaults criados por SQL manual;
--  foram omitidos de propósito.)
ALTER TYPE "KakeraReason" ADD VALUE IF NOT EXISTS 'MARKET_TRADE';
