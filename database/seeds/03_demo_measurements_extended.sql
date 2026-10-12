-- ================================================================
-- 03_demo_measurements_extended.sql  (v4 - variables re-insertadas)
-- Seed extendido: 8 variables + mediciones demo para CERO-010
-- Periodo : 2026-09-11 → 2026-10-10 (30 días)
-- Granularidad : horaria, turnos 06:00-22:00
-- Evento anomalía: 2026-10-03 10:00 → 2026-10-05 14:00
-- v4: variables 44...01-04 hardcodeadas (las originales desaparecieron)
-- NOTA: ejecutar con sqlcmd -I
-- ================================================================
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
USE VERTEX_DEMO;
GO

-- ----------------------------------------------------------------
-- 0. Limpiar mediciones simuladas previas de CERO-010
-- ----------------------------------------------------------------
DELETE FROM dbo.Mediciones
WHERE provenance = 'SIMULADA'
  AND equipo_id  = 'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCC01'
  AND event_time >= '2026-09-11'
  AND event_time <  '2026-10-11';

PRINT '>> Mediciones previas eliminadas: ' + CAST(@@ROWCOUNT AS VARCHAR(10));
GO

-- ----------------------------------------------------------------
-- 1. Insertar / actualizar las 8 variables del demo
-- ----------------------------------------------------------------
MERGE dbo.Variables AS tgt
USING (VALUES
  -- Variables de monitoreo eléctrico/mecánico (originales)
  ('44444444-4444-4444-4444-444444444401',
   'CORRIENTE_MOTOR', N'Corriente del motor',
   N'Corriente de fase en amperios — motor WEG W22 3CV (In ≈ 4.8 A)',
   'A',     'DECIMAL', 'HABILITADA', 1),
  ('44444444-4444-4444-4444-444444444402',
   'RPM_MOTOR',       N'Velocidad de rotación',
   N'Velocidad angular del eje — nominal 1740 RPM (4P, 60 Hz)',
   'RPM',   'DECIMAL', 'HABILITADA', 0),
  ('44444444-4444-4444-4444-444444444403',
   'TEMPERATURA_MOT', N'Temperatura del motor',
   N'Temperatura de bobinado — alarma > 65 °C (clase F: 155 °C)',
   N'°C',   'DECIMAL', 'HABILITADA', 0),
  ('44444444-4444-4444-4444-444444444404',
   'VOLTAJE_MOTOR',   N'Voltaje de alimentación',
   N'Tensión de fase en voltios — red trifásica 220 V Colombia',
   'V',     'DECIMAL', 'HABILITADA', 0),
  -- Variables nuevas
  ('55555555-5555-5555-5555-555555555501',
   'VIBRACION_MOT',  N'Vibración del motor',
   N'Aceleración RMS eje X — límite ISO 10816 Clase II: 7.1 mm/s',
   'mm/s',  'DECIMAL', 'HABILITADA', 1),
  ('55555555-5555-5555-5555-555555555502',
   'FRECUENCIA_RED', N'Frecuencia de red eléctrica',
   N'Frecuencia de la red de alimentación (Colombia: 60 Hz)',
   'Hz',    'DECIMAL', 'HABILITADA', 0),
  ('55555555-5555-5555-5555-555555555503',
   'POTENCIA_MOT',   N'Potencia activa consumida',
   N'Potencia activa trifásica: P = √3 × V × I × cosφ',
   'kW',    'DECIMAL', 'HABILITADA', 0),
  ('55555555-5555-5555-5555-555555555504',
   'ESTADO_MOTOR',   N'Estado de operación',
   N'1 = Encendido (en turno)  |  0 = Apagado (fuera de turno)',
   '-',     'INTEGER', 'HABILITADA', 0)
) AS src (variable_id, codigo, nombre, descripcion, unidad, tipo_dato, estado, es_diagnostico)
ON tgt.variable_id = src.variable_id
WHEN NOT MATCHED THEN
  INSERT (variable_id, codigo, nombre, descripcion, unidad, tipo_dato, estado, es_diagnostico)
  VALUES (src.variable_id, src.codigo, src.nombre, src.descripcion,
          src.unidad, src.tipo_dato, src.estado, src.es_diagnostico)
WHEN MATCHED THEN
  UPDATE SET codigo         = src.codigo,
             nombre         = src.nombre,
             descripcion    = src.descripcion,
             unidad         = src.unidad,
             tipo_dato      = src.tipo_dato,
             estado         = src.estado,
             es_diagnostico = src.es_diagnostico;

PRINT '>> Variables insertadas/verificadas: 8';
GO

-- ----------------------------------------------------------------
-- 2. Generar mediciones (WHILE loop, paso de 1 hora)
-- ----------------------------------------------------------------
DECLARE @equipo_id UNIQUEIDENTIFIER = 'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCC01';
DECLARE @motor_id  UNIQUEIDENTIFIER = 'DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDD02';

-- UUIDs hardcodeados para las 8 variables
DECLARE @v_corriente UNIQUEIDENTIFIER = '44444444-4444-4444-4444-444444444401';
DECLARE @v_rpm       UNIQUEIDENTIFIER = '44444444-4444-4444-4444-444444444402';
DECLARE @v_temp      UNIQUEIDENTIFIER = '44444444-4444-4444-4444-444444444403';
DECLARE @v_voltaje   UNIQUEIDENTIFIER = '44444444-4444-4444-4444-444444444404';
DECLARE @v_vibra     UNIQUEIDENTIFIER = '55555555-5555-5555-5555-555555555501';
DECLARE @v_freq      UNIQUEIDENTIFIER = '55555555-5555-5555-5555-555555555502';
DECLARE @v_pot       UNIQUEIDENTIFIER = '55555555-5555-5555-5555-555555555503';
DECLARE @v_estado    UNIQUEIDENTIFIER = '55555555-5555-5555-5555-555555555504';

DECLARE @dt      DATETIME2(3) = '2026-09-11 00:00:00';
DECLARE @dt_end  DATETIME2(3) = '2026-10-10 23:00:00';
DECLARE @ano_ini DATETIME2(3) = '2026-10-03 10:00:00';
DECLARE @ano_fin DATETIME2(3) = '2026-10-05 14:00:00';

DECLARE @hora      INT;
DECLARE @dia_num   INT;
DECLARE @turno     BIT;
DECLARE @en_ano    BIT;
DECLARE @noise     FLOAT;
DECLARE @corriente FLOAT;
DECLARE @rpm       FLOAT;
DECLARE @temp      FLOAT;
DECLARE @voltaje   FLOAT;
DECLARE @vibra     FLOAT;
DECLARE @freq      FLOAT;
DECLARE @potencia  FLOAT;
DECLARE @cnt       INT = 0;

WHILE @dt <= @dt_end
BEGIN
    SET @hora    = DATEPART(HOUR, @dt);
    SET @dia_num = DATEDIFF(DAY, '2026-09-11', @dt);
    SET @turno   = CASE WHEN @hora >= 6 AND @hora < 22 THEN 1 ELSE 0 END;
    SET @en_ano  = CASE WHEN @dt >= @ano_ini AND @dt <= @ano_fin THEN 1 ELSE 0 END;
    SET @noise   = ((@hora % 7) * 0.017) + ((@dia_num % 5) * 0.009) - 0.063;

    -- ESTADO siempre (24 h)
    INSERT INTO dbo.Mediciones
      (medicion_id, variable_id, equipo_id, motor_id, valor, unidad,
       event_time, received_time, provenance, calidad, modificada)
    VALUES (NEWID(), @v_estado, @equipo_id, @motor_id,
      @turno, '-', @dt, @dt, 'SIMULADA', 'BUENA', 0);
    SET @cnt = @cnt + 1;

    IF @turno = 1
    BEGIN
        SET @corriente = 2.28 + (@dia_num * 0.002) + @noise
                       + CASE WHEN @en_ano = 1 THEN 0.38 ELSE 0 END;
        SET @rpm       = 1718 + (@noise * 14)
                       - CASE WHEN @en_ano = 1 THEN 28 ELSE 0 END;
        SET @temp      = 44.0 + (@dia_num * 0.05)
                       + ((@hora - 6) * 0.35) + (@noise * 3)
                       + CASE WHEN @en_ano = 1 THEN 9.5 ELSE 0 END;
        SET @voltaje   = 220.0 + (@noise * 20)
                       - CASE WHEN @en_ano = 1 THEN 3.5 ELSE 0 END;
        SET @vibra     = 2.50 + (@dia_num * 0.012) + (@noise * 0.4)
                       + CASE WHEN @en_ano = 1 THEN 6.8 + ABS(@noise) * 1.5 ELSE 0 END;
        SET @freq      = 60.00 + (@noise * 0.04);
        -- P = √3 × V × I × cosφ  (cosφ WEG W22 ≈ 0.82)
        SET @potencia  = ROUND(1.7321 * @voltaje * @corriente * 0.82 / 1000, 4);

        -- CORRIENTE
        INSERT INTO dbo.Mediciones
          (medicion_id, variable_id, equipo_id, motor_id, valor, unidad,
           event_time, received_time, provenance, calidad, modificada)
        VALUES (NEWID(), @v_corriente, @equipo_id, @motor_id,
          ROUND(@corriente, 3), 'A', @dt, @dt, 'SIMULADA',
          CASE WHEN @en_ano = 1 THEN 'DUDOSA' ELSE 'BUENA' END, 0);

        -- RPM
        INSERT INTO dbo.Mediciones
          (medicion_id, variable_id, equipo_id, motor_id, valor, unidad,
           event_time, received_time, provenance, calidad, modificada)
        VALUES (NEWID(), @v_rpm, @equipo_id, @motor_id,
          ROUND(@rpm, 1), 'RPM', @dt, @dt, 'SIMULADA', 'BUENA', 0);

        -- TEMPERATURA
        INSERT INTO dbo.Mediciones
          (medicion_id, variable_id, equipo_id, motor_id, valor, unidad,
           event_time, received_time, provenance, calidad, modificada)
        VALUES (NEWID(), @v_temp, @equipo_id, @motor_id,
          ROUND(@temp, 2), N'°C', @dt, @dt, 'SIMULADA',
          CASE WHEN @temp > 65 THEN 'MALA'
               WHEN @temp > 58 THEN 'DUDOSA'
               ELSE 'BUENA' END, 0);

        -- VOLTAJE
        INSERT INTO dbo.Mediciones
          (medicion_id, variable_id, equipo_id, motor_id, valor, unidad,
           event_time, received_time, provenance, calidad, modificada)
        VALUES (NEWID(), @v_voltaje, @equipo_id, @motor_id,
          ROUND(@voltaje, 1), 'V', @dt, @dt, 'SIMULADA', 'BUENA', 0);

        -- VIBRACIÓN
        INSERT INTO dbo.Mediciones
          (medicion_id, variable_id, equipo_id, motor_id, valor, unidad,
           event_time, received_time, provenance, calidad, modificada)
        VALUES (NEWID(), @v_vibra, @equipo_id, @motor_id,
          ROUND(@vibra, 3), 'mm/s', @dt, @dt, 'SIMULADA',
          CASE WHEN @vibra > 7.1 THEN 'MALA'
               WHEN @vibra > 4.5 THEN 'DUDOSA'
               ELSE 'BUENA' END, 0);

        -- FRECUENCIA
        INSERT INTO dbo.Mediciones
          (medicion_id, variable_id, equipo_id, motor_id, valor, unidad,
           event_time, received_time, provenance, calidad, modificada)
        VALUES (NEWID(), @v_freq, @equipo_id, @motor_id,
          ROUND(@freq, 3), 'Hz', @dt, @dt, 'SIMULADA', 'BUENA', 0);

        -- POTENCIA
        INSERT INTO dbo.Mediciones
          (medicion_id, variable_id, equipo_id, motor_id, valor, unidad,
           event_time, received_time, provenance, calidad, modificada)
        VALUES (NEWID(), @v_pot, @equipo_id, @motor_id,
          @potencia, 'kW', @dt, @dt, 'SIMULADA', 'BUENA', 0);

        SET @cnt = @cnt + 7;
    END

    SET @dt = DATEADD(HOUR, 1, @dt);
END

PRINT '>> Mediciones insertadas: ' + CAST(@cnt AS VARCHAR(10));
GO

-- ----------------------------------------------------------------
-- 3. Resumen final
-- ----------------------------------------------------------------
SELECT
    v.codigo                    AS Variable,
    COUNT(*)                    AS Total_Mediciones,
    ROUND(MIN(m.valor), 2)      AS Min,
    ROUND(MAX(m.valor), 2)      AS Max,
    ROUND(AVG(m.valor), 3)      AS Promedio,
    SUM(CASE WHEN m.calidad = 'MALA'   THEN 1 ELSE 0 END) AS Malas,
    SUM(CASE WHEN m.calidad = 'DUDOSA' THEN 1 ELSE 0 END) AS Dudosas
FROM dbo.Mediciones m
JOIN dbo.Variables v ON v.variable_id = m.variable_id
GROUP BY v.codigo
ORDER BY v.codigo;
GO
