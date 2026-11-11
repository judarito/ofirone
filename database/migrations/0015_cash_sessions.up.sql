-- 0015_cash_sessions.up.sql
-- Migración productiva promovida desde docs/database-portability/_data/contracts/proposals/cash_sessions.sql (ADR-008).
-- Sin BEGIN/COMMIT: el runner Go envuelve la transacción.
-- Depende de 0001-0014; crea caja, movimientos, arqueo, enlace sales.cash_session_id y triggers.

CREATE TABLE public.cash_sessions (
    cash_session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'open',
    opened_by_identity_id uuid NOT NULL,
    opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    opening_float numeric(19,6) NOT NULL DEFAULT 0,
    closed_by_identity_id uuid,
    closed_at timestamptz,
    expected_cash numeric(19,6),
    counted_cash numeric(19,6),
    difference numeric(19,6),
    close_note text,
    open_idempotency_key text NOT NULL,
    close_idempotency_key text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, cash_session_id),
    UNIQUE (tenant_id, location_id, open_idempotency_key),
    UNIQUE (tenant_id, close_idempotency_key),
    FOREIGN KEY (tenant_id, location_id)
        REFERENCES public.locations (tenant_id, location_id) ON DELETE RESTRICT,
    FOREIGN KEY (opened_by_identity_id)
        REFERENCES public.identities (identity_id) ON DELETE RESTRICT,
    FOREIGN KEY (closed_by_identity_id)
        REFERENCES public.identities (identity_id) ON DELETE RESTRICT,
    CONSTRAINT cash_sessions_status_valid CHECK (status IN ('open', 'closed')),
    CONSTRAINT cash_sessions_opening_float_valid CHECK (opening_float >= 0),
    CONSTRAINT cash_sessions_open_key_valid CHECK (
        length(btrim(open_idempotency_key)) BETWEEN 1 AND 200
        AND open_idempotency_key = btrim(open_idempotency_key)
    ),
    CONSTRAINT cash_sessions_close_key_valid CHECK (
        close_idempotency_key IS NULL OR (
            length(btrim(close_idempotency_key)) BETWEEN 1 AND 200
            AND close_idempotency_key = btrim(close_idempotency_key)
        )
    ),
    CONSTRAINT cash_sessions_closed_state_valid CHECK (
        (status = 'open'
            AND closed_at IS NULL
            AND closed_by_identity_id IS NULL
            AND expected_cash IS NULL
            AND counted_cash IS NULL
            AND difference IS NULL
            AND close_idempotency_key IS NULL)
        OR
        (status = 'closed'
            AND closed_at IS NOT NULL
            AND closed_by_identity_id IS NOT NULL
            AND expected_cash IS NOT NULL
            AND counted_cash IS NOT NULL
            AND counted_cash >= 0
            AND difference IS NOT NULL
            AND close_idempotency_key IS NOT NULL
            AND difference = round(counted_cash - expected_cash, 6))
    ),
    CONSTRAINT cash_sessions_closed_after_open CHECK (
        closed_at IS NULL OR closed_at >= opened_at
    )
);

-- Una sola sesión abierta por sede: la base resuelve la carrera de apertura.
CREATE UNIQUE INDEX cash_sessions_one_open_idx
    ON public.cash_sessions (tenant_id, location_id)
    WHERE status = 'open';

CREATE INDEX cash_sessions_page_idx
    ON public.cash_sessions (tenant_id, opened_at DESC, cash_session_id DESC);
CREATE INDEX cash_sessions_location_page_idx
    ON public.cash_sessions (tenant_id, location_id, opened_at DESC, cash_session_id DESC);

CREATE TRIGGER cash_sessions_updated_at
BEFORE UPDATE ON public.cash_sessions
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Movimientos manuales del cajón (append-only)
-- Las ventas en efectivo NO se duplican aquí: se derivan de sale_payments.
-- ----------------------------------------------------------------------------
CREATE TABLE public.cash_movements (
    cash_movement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    cash_session_id uuid NOT NULL,
    movement_type text NOT NULL,
    direction text NOT NULL,
    amount numeric(19,6) NOT NULL,
    reason text,
    source_type text NOT NULL DEFAULT 'manual',
    source_id uuid,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_by_identity_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, cash_movement_id),
    UNIQUE (tenant_id, idempotency_key),
    FOREIGN KEY (tenant_id, cash_session_id)
        REFERENCES public.cash_sessions (tenant_id, cash_session_id)
        ON DELETE RESTRICT,
    FOREIGN KEY (created_by_identity_id)
        REFERENCES public.identities (identity_id) ON DELETE RESTRICT,
    CONSTRAINT cash_movements_type_valid CHECK (
        movement_type IN ('cash_in', 'cash_out', 'adjustment')
    ),
    CONSTRAINT cash_movements_direction_valid CHECK (direction IN ('in', 'out')),
    CONSTRAINT cash_movements_amount_positive CHECK (amount > 0),
    CONSTRAINT cash_movements_type_direction CHECK (
        (movement_type = 'cash_in' AND direction = 'in')
        OR (movement_type = 'cash_out' AND direction = 'out')
        OR movement_type = 'adjustment'
    ),
    CONSTRAINT cash_movements_reason_required CHECK (
        movement_type NOT IN ('cash_out', 'adjustment')
        OR (reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 500)
    ),
    CONSTRAINT cash_movements_source_valid CHECK (
        (source_type = 'manual' AND source_id IS NULL)
        OR (source_type IN ('sale', 'refund', 'correction') AND source_id IS NOT NULL)
    ),
    CONSTRAINT cash_movements_idempotency_valid CHECK (
        length(btrim(idempotency_key)) BETWEEN 1 AND 200
        AND idempotency_key = btrim(idempotency_key)
    )
);

CREATE INDEX cash_movements_session_idx
    ON public.cash_movements (tenant_id, cash_session_id, occurred_at, cash_movement_id);
CREATE INDEX cash_movements_page_idx
    ON public.cash_movements (tenant_id, occurred_at DESC, cash_movement_id DESC);

-- ----------------------------------------------------------------------------
-- 3. Arqueo por denominación
-- ----------------------------------------------------------------------------
CREATE TABLE public.cash_session_counts (
    cash_count_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    cash_session_id uuid NOT NULL,
    denomination numeric(19,6) NOT NULL,
    quantity integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, cash_count_id),
    UNIQUE (tenant_id, cash_session_id, denomination),
    FOREIGN KEY (tenant_id, cash_session_id)
        REFERENCES public.cash_sessions (tenant_id, cash_session_id)
        ON DELETE RESTRICT,
    CONSTRAINT cash_counts_denomination_positive CHECK (denomination > 0),
    CONSTRAINT cash_counts_quantity_nonnegative CHECK (quantity >= 0)
);

-- ----------------------------------------------------------------------------
-- 4. Atribución de la venta a la sesión (coherente con el modelo histórico)
-- ----------------------------------------------------------------------------
ALTER TABLE public.sales
    ADD COLUMN cash_session_id uuid;

ALTER TABLE public.sales
    ADD CONSTRAINT sales_cash_session_fk
    FOREIGN KEY (tenant_id, cash_session_id)
    REFERENCES public.cash_sessions (tenant_id, cash_session_id)
    ON DELETE RESTRICT;

CREATE INDEX sales_cash_session_idx
    ON public.sales (tenant_id, cash_session_id, sold_at, sale_id)
    WHERE cash_session_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. Función de totales esperados
-- expected = apertura + pagos cash de ventas de la sesión + movimientos in - out
-- ----------------------------------------------------------------------------
CREATE FUNCTION app_private.cash_session_expected_cash(
    p_tenant_id uuid,
    p_cash_session_id uuid
) RETURNS numeric
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT
        cs.opening_float
        + COALESCE((
            SELECT sum(sp.amount)
            FROM public.sales s
            JOIN public.sale_payments sp
              ON sp.tenant_id = s.tenant_id
             AND sp.sale_id = s.sale_id
            JOIN public.payment_methods pm
              ON pm.tenant_id = sp.tenant_id
             AND pm.payment_method_id = sp.payment_method_id
            WHERE s.tenant_id = cs.tenant_id
              AND s.cash_session_id = cs.cash_session_id
              AND pm.method_type = 'cash'
        ), 0)
        + COALESCE((
            SELECT sum(CASE m.direction
                         WHEN 'in' THEN m.amount
                         ELSE -m.amount
                       END)
            FROM public.cash_movements m
            WHERE m.tenant_id = cs.tenant_id
              AND m.cash_session_id = cs.cash_session_id
        ), 0)
    FROM public.cash_sessions cs
    WHERE cs.tenant_id = p_tenant_id
      AND cs.cash_session_id = p_cash_session_id
$$;

-- ----------------------------------------------------------------------------
-- 6. Guardas de estado y concurrencia
-- ----------------------------------------------------------------------------

-- La sesión cerrada es inmutable. Al cerrar valida expected y arqueo.
CREATE FUNCTION app_private.cash_sessions_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_expected numeric(19,6);
    v_counted numeric(19,6);
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status IS DISTINCT FROM 'open' THEN
            RAISE EXCEPTION 'una sesión de caja nueva debe abrirse en estado open'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'cash_sessions no admite DELETE'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'closed' THEN
        RAISE EXCEPTION 'cash_sessions cerrada es inmutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.location_id IS DISTINCT FROM OLD.location_id
       OR NEW.opened_by_identity_id IS DISTINCT FROM OLD.opened_by_identity_id
       OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
       OR NEW.opening_float IS DISTINCT FROM OLD.opening_float
       OR NEW.open_idempotency_key IS DISTINCT FROM OLD.open_idempotency_key
    THEN
        RAISE EXCEPTION 'campos de apertura de cash_sessions son inmutables'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'closed' THEN
        v_expected := app_private.cash_session_expected_cash(
            NEW.tenant_id, NEW.cash_session_id
        );
        IF NEW.expected_cash IS DISTINCT FROM v_expected THEN
            RAISE EXCEPTION 'expected_cash no coincide con ventas/movimientos'
                USING ERRCODE = '23514';
        END IF;

        SELECT COALESCE(sum(c.denomination * c.quantity), 0)
        INTO v_counted
        FROM public.cash_session_counts c
        WHERE c.tenant_id = NEW.tenant_id
          AND c.cash_session_id = NEW.cash_session_id;

        IF NEW.counted_cash IS DISTINCT FROM v_counted THEN
            RAISE EXCEPTION 'counted_cash no coincide con el arqueo'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Movimientos/counts solo sobre sesión abierta. FOR SHARE serializa con el
-- cierre, que bloquea la sesión con FOR UPDATE.
CREATE FUNCTION app_private.cash_requires_open_session() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_tenant_id uuid;
    v_session_id uuid;
    v_status text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_tenant_id := OLD.tenant_id;
        v_session_id := OLD.cash_session_id;
    ELSE
        v_tenant_id := NEW.tenant_id;
        v_session_id := NEW.cash_session_id;
    END IF;

    SELECT cs.status
    INTO v_status
    FROM public.cash_sessions cs
    WHERE cs.tenant_id = v_tenant_id
      AND cs.cash_session_id = v_session_id
    FOR SHARE;

    IF v_status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'la sesión de caja no está abierta'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- Una venta solo se atribuye a una sesión abierta de su misma sede.
CREATE FUNCTION app_private.sales_cash_session_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_status text;
    v_location_id uuid;
BEGIN
    IF NEW.cash_session_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.cash_session_id IS NOT NULL
       AND OLD.cash_session_id IS DISTINCT FROM NEW.cash_session_id
    THEN
        SELECT cs.status INTO v_status
        FROM public.cash_sessions cs
        WHERE cs.tenant_id = OLD.tenant_id
          AND cs.cash_session_id = OLD.cash_session_id
        FOR SHARE;

        IF v_status IS DISTINCT FROM 'open' THEN
            RAISE EXCEPTION 'no se puede sacar una venta de una sesión cerrada'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    SELECT cs.status, cs.location_id
    INTO v_status, v_location_id
    FROM public.cash_sessions cs
    WHERE cs.tenant_id = NEW.tenant_id
      AND cs.cash_session_id = NEW.cash_session_id
    FOR SHARE;

    IF v_status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'la sesión de caja de la venta no está abierta'
            USING ERRCODE = '23514';
    END IF;

    IF v_location_id IS DISTINCT FROM NEW.location_id THEN
        RAISE EXCEPTION 'la sesión de caja y la venta deben ser de la misma sede'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

-- Un pago no puede insertarse/modificarse si la venta pertenece a una sesión
-- ya cerrada. En UPDATE se comprueba también la sesión anterior.
CREATE FUNCTION app_private.sale_payment_cash_session_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_session_id uuid;
    v_status text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        SELECT s.cash_session_id INTO v_session_id
        FROM public.sales s
        WHERE s.tenant_id = OLD.tenant_id
          AND s.sale_id = OLD.sale_id;

        IF v_session_id IS NOT NULL THEN
            SELECT cs.status INTO v_status
            FROM public.cash_sessions cs
            WHERE cs.tenant_id = OLD.tenant_id
              AND cs.cash_session_id = v_session_id
            FOR SHARE;

            IF v_status IS DISTINCT FROM 'open' THEN
                RAISE EXCEPTION 'no se puede modificar un pago de una sesión cerrada'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    SELECT s.cash_session_id INTO v_session_id
    FROM public.sales s
    WHERE s.tenant_id = NEW.tenant_id
      AND s.sale_id = NEW.sale_id;

    IF v_session_id IS NOT NULL THEN
        SELECT cs.status INTO v_status
        FROM public.cash_sessions cs
        WHERE cs.tenant_id = NEW.tenant_id
          AND cs.cash_session_id = v_session_id
        FOR SHARE;

        IF v_status IS DISTINCT FROM 'open' THEN
            RAISE EXCEPTION 'la sesión del pago no está abierta'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER cash_sessions_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.cash_sessions
FOR EACH ROW EXECUTE FUNCTION app_private.cash_sessions_guard();

CREATE TRIGGER cash_movements_open_session
BEFORE INSERT ON public.cash_movements
FOR EACH ROW EXECUTE FUNCTION app_private.cash_requires_open_session();

CREATE TRIGGER cash_session_counts_open_session
BEFORE INSERT OR DELETE ON public.cash_session_counts
FOR EACH ROW EXECUTE FUNCTION app_private.cash_requires_open_session();

CREATE TRIGGER sales_cash_session_guard
BEFORE INSERT OR UPDATE OF cash_session_id, location_id ON public.sales
FOR EACH ROW EXECUTE FUNCTION app_private.sales_cash_session_guard();

CREATE TRIGGER sale_payment_cash_session_guard
BEFORE INSERT OR UPDATE ON public.sale_payments
FOR EACH ROW EXECUTE FUNCTION app_private.sale_payment_cash_session_guard();

-- ----------------------------------------------------------------------------
-- 7. RLS portable (sin Supabase), FORCE y mínimo privilegio
-- ----------------------------------------------------------------------------
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_sessions_select ON public.cash_sessions
FOR SELECT USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY cash_sessions_insert ON public.cash_sessions
FOR INSERT WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY cash_sessions_update ON public.cash_sessions
FOR UPDATE
USING (tenant_id = app_private.current_tenant_id())
WITH CHECK (tenant_id = app_private.current_tenant_id());

ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_movements_select ON public.cash_movements
FOR SELECT USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY cash_movements_insert ON public.cash_movements
FOR INSERT WITH CHECK (tenant_id = app_private.current_tenant_id());
-- Sin política UPDATE/DELETE: append-only para el runtime.

ALTER TABLE public.cash_session_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_session_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_counts_select ON public.cash_session_counts
FOR SELECT USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY cash_counts_insert ON public.cash_session_counts
FOR INSERT WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY cash_counts_delete ON public.cash_session_counts
FOR DELETE USING (tenant_id = app_private.current_tenant_id());

REVOKE ALL ON public.cash_sessions FROM PUBLIC;
REVOKE ALL ON public.cash_movements FROM PUBLIC;
REVOKE ALL ON public.cash_session_counts FROM PUBLIC;

REVOKE ALL ON FUNCTION app_private.cash_session_expected_cash(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.cash_sessions_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.cash_requires_open_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.sales_cash_session_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.sale_payment_cash_session_guard() FROM PUBLIC;

-- Grants de referencia; el rol ofirone_api es una propuesta (runtime-roles-proposal.sql).
-- El trigger cash_sessions_guard restringe qué columnas/estados puede cambiar el API.
-- GRANT SELECT, INSERT, UPDATE ON public.cash_sessions TO ofirone_api;
-- GRANT SELECT, INSERT ON public.cash_movements TO ofirone_api;
-- GRANT SELECT, INSERT, DELETE ON public.cash_session_counts TO ofirone_api;
-- GRANT EXECUTE ON FUNCTION app_private.cash_session_expected_cash(uuid, uuid) TO ofirone_api;

-- ----------------------------------------------------------------------------
-- 8. Comentarios
-- ----------------------------------------------------------------------------
COMMENT ON TABLE public.cash_sessions IS
    'Turno de caja por tenant y sede; una sola sesión abierta por sede.';
COMMENT ON COLUMN public.cash_sessions.expected_cash IS
    'Snapshot al cierre: apertura + pagos cash de la sesión + movimientos in - out.';
COMMENT ON COLUMN public.cash_sessions.difference IS
    'counted_cash - expected_cash; positivo = sobrante, negativo = faltante.';
COMMENT ON TABLE public.cash_movements IS
    'Movimientos manuales del cajón; las ventas cash se derivan de sale_payments.';
COMMENT ON TABLE public.cash_session_counts IS
    'Arqueo por denominación; su suma debe igualar counted_cash al cerrar.';
COMMENT ON COLUMN public.sales.cash_session_id IS
    'Sesión de caja de la venta; NULL = venta sin turno. FK compuesta por tenant.';

-- ----------------------------------------------------------------------------


-- ----------------------------------------------------------------------------
-- 7. Append-only de movimientos de caja (endurecimiento Slice G)
-- ----------------------------------------------------------------------------
create function app_private.cash_movements_append_only() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    raise exception 'cash_movements es append-only: % no permitido', tg_op
        using errcode = '23514';
end;
$$;

drop trigger if exists cash_movements_append_only on public.cash_movements;
create trigger cash_movements_append_only
before update or delete on public.cash_movements
for each row execute function app_private.cash_movements_append_only();

comment on function app_private.cash_movements_append_only() is
    'Bloquea UPDATE/DELETE sobre cash_movements; los movimientos son inmutables.';

-- FIN
