/**
 * A barra de título — a faixa que substitui a moldura nativa.
 *
 * A janela nasce sem barra de título do sistema (`titleBarStyle: "hidden"` no
 * `main.ts`); o Electron desenha só os três controles no canto direito e deixa
 * o resto por nossa conta. Esta faixa de 40px é o resto: a marca à esquerda,
 * sobre o trilho, e o nome da tela atual ao centro, onde um título de janela
 * sempre esteve.
 *
 * `-webkit-app-region: drag` é o que permite arrastar a janela por ela — sem
 * isso a janela fica presa no lugar, que é a primeira coisa que qualquer
 * pessoa nota. Os controles do canto direito são do sistema e ficam por cima;
 * a faixa não põe nada nos últimos 140px para não competir com eles.
 */

import logo from "../assets/logo.png";

export function BarraDeTitulo({ titulo }: { titulo: string }) {
  return (
    <div
      className={[
        "flex h-10 shrink-0 items-center border-b border-border-subtle bg-surface-sunken",
        "select-none [-webkit-app-region:drag]",
      ].join(" ")}
    >
      <div className="flex w-[240px] shrink-0 items-center gap-2.5 px-4">
        <img
          src={logo}
          alt=""
          aria-hidden="true"
          className="size-6 shrink-0 rounded-[6px] object-cover"
          draggable={false}
        />
        <span className="font-serif text-sm tracking-tight text-text">
          TecJustiça{" "}
          <span className="font-semibold text-accent">Sigilo</span>
        </span>
      </div>
      <span className="min-w-0 flex-1 truncate pr-[140px] text-center font-mono text-xs text-text-tertiary">
        {titulo}
      </span>
    </div>
  );
}
