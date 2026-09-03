export interface GraphRecipe {
  readonly recipeId: number;
  readonly facilityTypeCode: string;
  readonly outputProductId: number;
  readonly unlockLevel: number;
  readonly inputProductIds: readonly number[];
}

export interface GraphProduct {
  readonly id: number;
  readonly code: string;
  readonly unlockLevel: number;
  readonly isRawMaterial: boolean;
  readonly isRetailProduct: boolean;
}

export interface GraphIssue {
  readonly kind: 'CYCLE' | 'UNLOCK_ORDER' | 'UNREACHABLE' | 'DUPLICATE_OUTPUT';
  readonly message: string;
  readonly productIds: readonly number[];
}

export interface GraphReport {
  readonly ok: boolean;
  readonly issues: readonly GraphIssue[];
  /** Üretim sırası: girdiler her zaman çıktılardan önce gelir. */
  readonly topologicalOrder: readonly number[];
}

/**
 * Ürün grafı doğrulaması — değişmez I8 (docs/02 §5), risk R13.
 *
 * Ürünler yönlü asiklik bir graf oluşturur (hammadde → ara → nihai).
 * Admin panelden "Çelik → Motor" ve "Motor → Çelik" girilirse üretim fazı
 * sonsuz döngüye girer; bu yüzden reçete kaydında ve CI'da doğrulanır.
 *
 * Saf fonksiyondur: veritabanına dokunmaz, çağıran veriyi toplar.
 */
export function validateProductGraph(
  recipes: readonly GraphRecipe[],
  products: readonly GraphProduct[],
): GraphReport {
  const issues: GraphIssue[] = [];
  const byId = new Map(products.map((p) => [p.id, p]));

  // Aynı ürünü üreten birden çok reçete belirsizlik yaratır
  const producedBy = new Map<number, GraphRecipe[]>();
  for (const recipe of recipes) {
    const list = producedBy.get(recipe.outputProductId) ?? [];
    list.push(recipe);
    producedBy.set(recipe.outputProductId, list);
  }
  for (const [productId, list] of producedBy) {
    if (list.length > 1) {
      const facilities = [...new Set(list.map((r) => r.facilityTypeCode))];
      if (facilities.length !== list.length) {
        issues.push({
          kind: 'DUPLICATE_OUTPUT',
          message: `${byId.get(productId)?.code ?? productId} aynı tesis tipinde birden çok reçeteyle üretiliyor`,
          productIds: [productId],
        });
      }
    }
  }

  // Kenarlar: girdi → çıktı
  const edges = new Map<number, Set<number>>();
  for (const recipe of recipes) {
    for (const input of recipe.inputProductIds) {
      const targets = edges.get(input) ?? new Set<number>();
      targets.add(recipe.outputProductId);
      edges.set(input, targets);
    }
  }

  // Kahn algoritması ile topolojik sıralama; artakalan düğüm varsa döngü vardır
  const indegree = new Map<number, number>();
  for (const product of products) indegree.set(product.id, 0);
  for (const [, targets] of edges) {
    for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1);
  }

  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id).sort((a, b) => a - b);
  const order: number[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const target of edges.get(node) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }

  if (order.length !== products.length) {
    const inCycle = products.filter((p) => !order.includes(p.id)).map((p) => p.id);
    issues.push({
      kind: 'CYCLE',
      message: `Ürün grafında döngü var: ${inCycle.map((id) => byId.get(id)?.code ?? id).join(' → ')}`,
      productIds: inCycle,
    });
  }

  // Bir reçetenin seviyesi, girdilerinin seviyesinden küçük olamaz:
  // aksi halde oyuncu üretemeyeceği bir girdiyi gerektiren reçeteyi açar.
  for (const recipe of recipes) {
    for (const inputId of recipe.inputProductIds) {
      const input = byId.get(inputId);
      if (input && input.unlockLevel > recipe.unlockLevel) {
        issues.push({
          kind: 'UNLOCK_ORDER',
          message:
            `${byId.get(recipe.outputProductId)?.code} reçetesi Lv${recipe.unlockLevel}'de açılıyor ` +
            `ama girdisi ${input.code} Lv${input.unlockLevel}'de açılıyor`,
          productIds: [recipe.outputProductId, inputId],
        });
      }
    }
  }

  // Hammadde olmayan ve hiçbir reçeteyle üretilmeyen ürün ulaşılamazdır
  for (const product of products) {
    if (product.isRawMaterial) continue;
    if (!producedBy.has(product.id)) {
      issues.push({
        kind: 'UNREACHABLE',
        message: `${product.code} hiçbir reçeteyle üretilemiyor ve hammadde değil`,
        productIds: [product.id],
      });
    }
  }

  return { ok: issues.length === 0, issues, topologicalOrder: order };
}
