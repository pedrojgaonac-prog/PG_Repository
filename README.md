# Mis Gastos

App web para supervisar tus gastos mensuales a partir de tu Excel. Funciona en el
celular, la tablet y la computadora, se puede **instalar como app** (PWA) y
funciona sin conexión.

![Resumen](https://img.shields.io/badge/datos-solo%20en%20tu%20dispositivo-0f766e)

## Qué hace

- **Importa tu Excel** (`.xlsx`, `.xls`, `.csv`, `.ods`) y detecta solas las columnas
  de fecha, monto, categoría, descripción y tipo. Puedes corregirlas antes de importar.
- Soporta dos formatos de hoja:
  1. **Una fila por gasto**: `Fecha | Concepto | Categoría | Importe | Tipo`.
  2. **Tabla mensual / presupuesto**: categorías en filas y un mes por columna
     (`Enero`, `Feb 2026`, `03/2026`, `ENE 1A Q`…). Es el formato de `GASTOS_PH_2026.xlsx`:
     - detecta la fila de meses, la columna de categorías y las secciones INGRESOS / GASTOS;
     - toma la columna **ESTIMADO** como presupuesto mensual por categoría;
     - deja de leer en **RESULTADO** (lo de abajo son cálculos auxiliares);
     - ignora filas TOTAL y columnas de % y TOTAL;
     - columnas que no son un mes (p. ej. **Premiums and bonus**) se pueden sumar al mes que elijas o dejar fuera;
     - los negativos dentro de gastos (p. ej. *Viene 2025*, reintegros) cuentan como ingreso.
- Entiende montos como `1.234,56`, `$1,234.56`, `(45)` o `-45`, y fechas `dd/mm/aaaa`,
  `aaaa-mm-dd`, `5 de marzo de 2026` o fechas nativas de Excel.
- **Resumen del mes**: total gastado, variación vs. mes anterior, ingresos y balance,
  promedio de 6 meses y proyección a fin de mes.
- Gráfico por categoría y tendencia de los últimos 12 meses (toca una barra para ir a ese mes).
- **Presupuestos por categoría** con barras de avance (verde / ámbar al 85 % / rojo al pasarse)
  y sugerencia basada en el promedio de los últimos 3 meses.
- Agregar, editar y borrar movimientos a mano desde el celular.
- Al re-importar, el modo **"Actualizar lo importado antes desde esta hoja"** reemplaza
  lo que vino de esa hoja por los valores actuales (sin duplicar y sin tocar los
  movimientos agregados a mano). Así sigues usando tu Excel como siempre y lo vuelves a
  cargar cuando lo actualices.
- Exportar a Excel y copia de seguridad en JSON.

## Privacidad

No hay servidor: los datos se guardan en el navegador del dispositivo (localStorage).
Nada se sube a internet.

**Usar en varios dispositivos:** importa el mismo Excel en cada uno, o usa
*Ajustes → Exportar copia* en uno y *Restaurar copia* en el otro.

## Publicarla para abrirla desde cualquier dispositivo (GitHub Pages)

1. Fusiona esta rama en `main`.
2. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. El workflow `.github/workflows/pages.yml` corre las pruebas y publica la app en
   `https://<tu-usuario>.github.io/<repositorio>/`.
   > GitHub Pages en repositorios **privados** requiere un plan de pago. Aunque el
   > repositorio sea público, tus datos siguen siendo privados: solo el código es visible.

### Instalarla como app

- **iPhone / iPad (Safari):** Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome):** menú ⋮ → *Instalar app*.
- **Computadora (Chrome / Edge):** icono de instalar en la barra de direcciones.

## Probar en local

```bash
npm start      # sirve la app en http://localhost:8080
npm test       # pruebas del lector de Excel
```

En `ejemplos/gastos-ejemplo.xlsx` hay un archivo de muestra con ambos formatos.

## Estructura

| Archivo | Descripción |
|---|---|
| `index.html`, `styles.css` | Interfaz (móvil primero, modo claro/oscuro) |
| `js/parse.js` | Lectura de fechas, montos, columnas y formatos del Excel (con pruebas) |
| `js/app.js` | Lógica de la app: resumen, gráficos, presupuestos, importación |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación como app y uso sin conexión |
| `vendor/` | SheetJS (lectura de Excel) y Chart.js (gráficos), incluidos localmente |

Si cambias archivos de la app, sube la versión de `CACHE` en `sw.js` para que los
dispositivos instalados reciban la actualización.
