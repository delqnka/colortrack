import { useState, useEffect, useCallback } from 'react';
import Purchases from 'react-native-purchases';

export const ENTITLEMENT_ID = 'Color Bar Suite Pro';

export function useEntitlement() {
  const [isActive, setIsActive] = useState(false);
  const [isTrial, setIsTrial] = useState(false);
  const [expirationDate, setExpirationDate] = useState(null);
  const [purchaseDate, setPurchaseDate] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const info = await Purchases.getCustomerInfo();
      const ent = info.entitlements.active[ENTITLEMENT_ID];
      const active = Boolean(ent);
      setIsActive(active);
      setIsTrial(ent?.periodType === 'trial' ?? false);
      setExpirationDate(ent?.expirationDate ?? null);
      setPurchaseDate(ent?.latestPurchaseDate ?? null);
      return active;
    } catch {
      // RC not configured or network error — treat as unknown, not as "no subscription"
      setIsActive(false);
      return null; // null = unknown (don't show paywall)
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { isActive, isTrial, expirationDate, purchaseDate, loading, refresh };
}
