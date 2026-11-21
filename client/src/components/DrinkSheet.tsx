import { useEffect, useState } from 'react';
import type { MenuItemDTO, MenuResponse, ToppingDTO } from '../../../shared/types';
import { formatVnd } from '../lib/format';
import { CloseIcon, MinusIcon, PlusIcon } from './Icons';

export interface CartEntry {
  uid: string;
  item: MenuItemDTO;
  variant?: string;
  size?: 'M' | 'L';
  sizeLabel?: string;
  sizePrice: number;
  sugar?: string;
  ice?: string;
  toppings: ToppingDTO[];
  note: string;
  quantity: number;
  unitPrice: number;
}

interface DrinkSheetProps {
  item: MenuItemDTO;
  menu: MenuResponse;
  onClose: () => void;
  onAdd: (entry: CartEntry) => void;
}

export function DrinkSheet({ item, menu, onClose, onAdd }: DrinkSheetProps) {
  const iceChoices = menu.iceOptionsByType[item.drinkType] || [];
  const availableToppings = menu.toppings.filter((t) => t.isAvailable);

  const [variant, setVariant] = useState<string | undefined>(item.variants[0]);
  const [sizeId, setSizeId] = useState<'M' | 'L'>('M');
  const [ice, setIce] = useState<string | undefined>(iceChoices[0]);
  const [sugar, setSugar] = useState<string | undefined>(
    item.allowSugar ? menu.sugarOptions[0] : undefined
  );
  const [selectedToppings, setSelectedToppings] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sizeObj = item.allowSize
    ? menu.sizeOptions.find((s) => s.id === sizeId) || menu.sizeOptions[0]
    : undefined;
  const sizePrice = sizeObj?.extraPrice || 0;

  const chosenToppings = availableToppings.filter((t) => selectedToppings.includes(t.slug));
  const toppingsTotal = chosenToppings.reduce((sum, t) => sum + t.price, 0);
  const unitPrice = item.price + sizePrice + toppingsTotal;
  const lineTotal = unitPrice * quantity;

  function toggleTopping(slug: string) {
    setSelectedToppings((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }

  function handleSubmit() {
    const keyParts = [
      item.id,
      variant || '',
      sizeObj?.id || '',
      ice || '',
      sugar || '',
      [...selectedToppings].sort().join(','),
      note.trim(),
    ];
    onAdd({
      uid: keyParts.join('|'),
      item,
      variant,
      size: sizeObj?.id,
      sizeLabel: sizeObj?.label,
      sizePrice,
      sugar,
      ice: item.allowIce ? ice : item.drinkType === 'hot_only' ? 'Nóng' : undefined,
      toppings: chosenToppings,
      note: note.trim(),
      quantity,
      unitPrice,
    });
    onClose();
  }

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drink-sheet-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-panel">
        <div className="sheet-header">
          <h2 className="sheet-title" id="drink-sheet-title">
            Tùy chọn món
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Đóng">
            <CloseIcon />
          </button>
        </div>

        <div className="sheet-body">
          <div className="drink-sheet-hero">
            <div
              className={`drink-sheet-photo ${item.imageFit === 'cover' ? 'drink-sheet-photo--cover' : ''}`}
            >
              <img src={item.imageUrl} alt={item.name} />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.25 }}>{item.name}</div>
              {item.description && (
                <p style={{ margin: '4px 0 6px', fontSize: 13.5, color: 'var(--ink-muted)' }}>
                  {item.description}
                </p>
              )}
              <div className="drink-price">{formatVnd(item.price)}</div>
            </div>
          </div>

          {item.variants.length > 0 && (
            <div className="option-group">
              <div className="option-label-row">
                <span className="option-label">Chọn vị</span>
                <span className="option-hint">Bắt buộc</span>
              </div>
              <div className="pill-grid">
                {item.variants.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`choice-pill ${variant === v ? 'choice-pill--selected' : ''}`}
                    onClick={() => setVariant(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {item.allowSize && (
            <div className="option-group">
              <div className="option-label-row">
                <span className="option-label">Chọn size</span>
                <span className="option-hint">Đá hay nóng cùng giá</span>
              </div>
              <div className="pill-grid">
                {menu.sizeOptions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`choice-pill ${sizeId === s.id ? 'choice-pill--selected' : ''}`}
                    onClick={() => setSizeId(s.id)}
                  >
                    <span>{s.label}</span>
                    {s.extraPrice > 0 && (
                      <span className="tabular">+{Math.round(s.extraPrice / 1000)}k</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {item.allowIce && iceChoices.length > 0 && (
            <div className="option-group">
              <div className="option-label-row">
                <span className="option-label">Mức đá / Nhiệt độ</span>
              </div>
              <div className="pill-grid">
                {iceChoices.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`choice-pill ${ice === opt ? 'choice-pill--selected' : ''}`}
                    onClick={() => setIce(opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {item.allowSugar && (
            <div className="option-group">
              <div className="option-label-row">
                <span className="option-label">Mức đường</span>
              </div>
              <div className="pill-grid">
                {menu.sugarOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`choice-pill ${sugar === opt ? 'choice-pill--selected' : ''}`}
                    onClick={() => setSugar(opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {item.allowToppings && availableToppings.length > 0 && (
            <div className="option-group">
              <div className="option-label-row">
                <span className="option-label">Thêm topping</span>
                <span className="option-hint">Chỉ gọi thêm khi cần</span>
              </div>
              <div className="topping-list">
                {availableToppings.map((t) => {
                  const checked = selectedToppings.includes(t.slug);
                  return (
                    <label
                      key={t.slug}
                      className={`topping-row ${checked ? 'topping-row--selected' : ''}`}
                    >
                      <span className="topping-left">
                        <input
                          type="checkbox"
                          className="topping-checkbox"
                          checked={checked}
                          onChange={() => toggleTopping(t.slug)}
                        />
                        <span>{t.name}</span>
                      </span>
                      <span className="topping-price">+{formatVnd(t.price)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="drink-note">
              Ghi chú riêng cho ly này (không bắt buộc)
            </label>
            <input
              id="drink-note"
              type="text"
              className="field-input"
              maxLength={140}
              placeholder="Ví dụ: ít sữa đặc, để đá riêng..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className="sheet-footer">
          <div className="qty-stepper" aria-label="Số lượng">
            <button
              type="button"
              className="qty-btn"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              aria-label="Giảm số lượng"
            >
              <MinusIcon size={16} />
            </button>
            <span className="qty-val">{quantity}</span>
            <button
              type="button"
              className="qty-btn"
              onClick={() => setQuantity((q) => Math.min(20, q + 1))}
              aria-label="Tăng số lượng"
            >
              <PlusIcon size={16} />
            </button>
          </div>

          <button type="button" className="btn-primary" onClick={handleSubmit}>
            <span>Thêm vào giỏ</span>
            <span className="tabular">· {formatVnd(lineTotal)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
