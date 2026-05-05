import { useState, useEffect, useCallback } from 'react';
import Purchases from 'react-native-purchases';

export const ENTITLEMENT_ID = 'Color Bar Suite Pro';

export function useEntitlement() {
  const [isActive, setIsActive] = useState(false);
  const [isTrial, setIsTrial] = useState(false);
  const [expirationDate, setExpirationDate] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const info = await Purchases.getCustomerInfo();
      const ent = info.entitlements.active[ENTITLEMENT_ID];
      const active = Boolean(ent);
      setIsActive(active);
      setIsTrial(ent?.periodType === 'trial' ?? false);
      setExpirationDate(ent?.expirationDate ?? null);
      return active;
    } catch {
      setIsActive(false);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { isActive, isTrial, expirationDate, loading, refresh };
}
