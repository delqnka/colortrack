import React, { useEffect, useCallback, useState, useRef } from 'react';
import { View, Pressable, Text, TextInput, StyleSheet, DeviceEventEmitter, Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import { useFonts, Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from '@expo-google-fonts/manrope';
import * as SplashScreen from 'expo-splash-screen';
import { BlurView } from 'expo-blur';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';

const navigationRef = createNavigationContainerRef();
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';

import HomeScreen from './src/screens/HomeScreen';
import ClientsScreen from './src/screens/ClientsScreen';
import ClientDetailScreen from './src/screens/ClientDetailScreen';
import ClientFormScreen from './src/screens/ClientFormScreen';
import AppointmentFormScreen from './src/screens/AppointmentFormScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import InventoryItemScreen from './src/screens/InventoryItemScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import FormulaBuilderScreen from './src/screens/FormulaBuilderScreen';
import VisitDetailScreen from './src/screens/VisitDetailScreen';
import LabScreen from './src/screens/LabScreen';
import FinanceScreen from './src/screens/FinanceScreen';
import LoginScreen from './src/screens/LoginScreen';
import WelcomeScreen from './src/onboarding/screens/WelcomeScreen';
import OnboardingCarouselScreen from './src/onboarding/screens/OnboardingCarouselScreen';
import OnboardingAuthScreen from './src/onboarding/screens/OnboardingAuthScreen';
import OnboardingEmailScreen from './src/onboarding/screens/OnboardingEmailScreen';
import { isOnboardingComplete } from './src/onboarding/storage';
import ProfileScreen from './src/screens/ProfileScreen';
import AffiliateScreen from './src/screens/AffiliateScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import { useEntitlement } from './src/hooks/useEntitlement';
import TodaySalesScreen from './src/screens/TodaySalesScreen';
import ServicesScreen from './src/screens/ServicesScreen';
import { CurrencyProvider } from './src/context/CurrencyContext';
import { loadStoredToken, flushOutbox } from './src/api/client';
import { registerExpoPushIfPossible } from './src/push/registerPush';
import { useAffiliateTracker, applyAffiliateAttribute } from './src/hooks/useAffiliateTracker';
import { FontFamily } from './src/theme/fonts';
import { TAB_BAR_ACTIVE_BUBBLE, MY_LAB_VIOLET } from './src/theme/glassUi';
import SFIcon from './src/components/SFIcon';

SplashScreen.preventAutoHideAsync().catch(() => {});

const Tab = createBottomTabNavigator();
const GuestStack = createNativeStackNavigator();
const AppStack = createNativeStackNavigator();
const DashboardStack = createNativeStackNavigator();

const NAV_BG_WHITE = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#FFFFFF',
    card: '#FFFFFF',
    border: 'rgba(0,0,0,0)',
  },
};

const TAB_H = 74;
const ICON_SIZE = 22;


function DashboardStackScreen() {
  return (
    <DashboardStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#FFFFFF' },
      }}
    >
      <DashboardStack.Screen name="DashboardHome" component={HomeScreen} />
      <DashboardStack.Screen
        name="DashboardCalendar"
        component={CalendarScreen}
        options={{ gestureEnabled: true, fullScreenGestureEnabled: true }}
      />
    </DashboardStack.Navigator>
  );
}

function GlassTabBar({ state, descriptors, navigation }) {
  const icons = {
    Dashboard: 'home',
    Clients: 'people-outline',
    Calendar: 'calendar-outline',
  };

  return (
    <View pointerEvents="box-none" style={styles.tabBarShell}>
      <View style={styles.tabBar}>
        <BlurView
          tint="dark"
          intensity={Platform.OS === 'ios' ? 52 : 72}
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
        <View style={[StyleSheet.absoluteFillObject, styles.tabBarDarkVeil]} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFillObject, styles.tabBarGlassRim]} pointerEvents="none" />
        <View style={styles.tabIconsRow}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const { options } = descriptors[route.key];
            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            };
            const onLongPress = () => {
              navigation.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            };

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={focused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                testID={options.tabBarButtonTestID}
                onPress={onPress}
                onLongPress={onLongPress}
                style={styles.tabButton}
                android_ripple={{ borderless: true }}
              >
                <View style={focused ? styles.activeIconCircle : styles.inactiveIconWrap}>
                  {route.name === 'Inventory' ? (
                    <SFIcon
                      name="file-tray-full"
                      iosName="cabinet.fill"
                      size={focused ? 28 : ICON_SIZE}
                      color={focused ? MY_LAB_VIOLET : '#FFFFFF'}
                    />
                  ) : (
                    <Ionicons
                      name={icons[route.name] || 'ellipse-outline'}
                      size={focused ? 28 : ICON_SIZE}
                      color={focused ? MY_LAB_VIOLET : '#FFFFFF'}
                    />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function MainTabs() {
  const screenOptions = () => ({
    headerShown: false,
    tabBarShowLabel: false,
    sceneStyle: { flex: 1, backgroundColor: '#FFFFFF' },
  });

  return (
    <Tab.Navigator
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={screenOptions}
    >
      <Tab.Screen name="Dashboard" component={DashboardStackScreen} />
      <Tab.Screen name="Clients" component={ClientsScreen} />
      <Tab.Screen name="Inventory" component={InventoryScreen} />
      <Tab.Screen name="Calendar" component={CalendarScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBarShell: {
    position: 'absolute',
    left: 28,
    right: 28,
    bottom: 26,
    height: TAB_H,
    borderRadius: 999,
    shadowColor: '#1C1C1E',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 14,
  },
  tabBar: {
    flex: 1,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(18, 18, 22, 0.72)',
  },
  tabBarDarkVeil: {
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
  tabBarGlassRim: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  tabIconsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 5,
  },
  tabButton: {
    flex: 1,
    minHeight: TAB_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: TAB_BAR_ACTIVE_BUBBLE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 8,
  },
  inactiveIconWrap: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 1,
  },
});

export default function App() {
  useAffiliateTracker();

  useEffect(() => {
    const key = Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_RC_IOS_KEY
      : process.env.EXPO_PUBLIC_RC_ANDROID_KEY;
    if (key) {
      Purchases.configure({ apiKey: key });
    }
  }, []);

  const [fontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  const [authReady, setAuthReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  const navigateToPaywall = useCallback(() => {
    if (navigationRef.isReady()) {
      navigationRef.navigate('Paywall');
    } else {
      const unsub = navigationRef.addListener('state', () => {
        unsub();
        navigationRef.navigate('Paywall');
      });
    }
  }, []);

  useEffect(() => {
    if (showPaywall && signedIn) navigateToPaywall();
  }, [showPaywall, signedIn, navigateToPaywall]);
  const { isActive: hasEntitlement, loading: entitlementLoading, refresh: refreshEntitlement } = useEntitlement();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const textFontDefaultsApplied = useRef(false);

  const refreshAuth = useCallback(async () => {
    const t = await loadStoredToken();
    // Auth state is set immediately — never blocked by RC or network
    setSignedIn(Boolean(t));
    setAuthReady(true);
    if (t) {
      flushOutbox();
      registerExpoPushIfPossible();
      applyAffiliateAttribute();
      // Entitlement check runs in background — does not block login
      refreshEntitlement().then((result) => {
        if (result === false) setShowPaywall(true);
      }).catch(() => {});
    }
  }, [refreshEntitlement]);

  useEffect(() => {
    refreshAuth();
    const sub = NetInfo.addEventListener(() => {
      flushOutbox();
    });
    return () => sub();
  }, [refreshAuth]);

  useEffect(() => {
    let cancelled = false;

    if (!fontsLoaded || !authReady) return undefined;

    if (signedIn) {
      setOnboardingChecked(true);
      return undefined;
    }

    isOnboardingComplete().then((done) => {
      if (!cancelled) setOnboardingDone(Boolean(done));
      setOnboardingChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fontsLoaded, authReady, signedIn]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('colortrack:session-cleared', () => {
      setSignedIn(false);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!fontsLoaded || textFontDefaultsApplied.current) return;
    textFontDefaultsApplied.current = true;
    const base = { fontFamily: FontFamily.regular };
    const merge = (Comp) => {
      const prev = Comp.defaultProps?.style;
      /** Base defaults first — screen typography must override (no Regular last wiping Medium). */
      const nextStyle =
        prev == null
          ? base
          : Array.isArray(prev)
            ? [base, ...prev]
            : [base, prev];
      Comp.defaultProps = { ...Comp.defaultProps, style: nextStyle };
    };
    merge(Text);
    merge(TextInput);
    SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);


  if (!fontsLoaded || !authReady || !onboardingChecked) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: '#fff' }} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <CurrencyProvider>
        <NavigationContainer ref={navigationRef} theme={NAV_BG_WHITE}>
          {!signedIn ? (
            <GuestStack.Navigator
              key={`guest-${String(onboardingDone)}`}
              initialRouteName={onboardingDone ? 'OnboardingEmail' : 'OnboardingWelcome'}
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#FFFFFF' },
              }}
            >
              <GuestStack.Screen
                name="OnboardingWelcome"
                component={WelcomeScreen}
                options={{
                  animation: 'fade',
                  contentStyle: { backgroundColor: '#1A1A2E' },
                }}
              />
              <GuestStack.Screen name="OnboardingCarousel" component={OnboardingCarouselScreen} />
              <GuestStack.Screen name="OnboardingAuth">
                {(props) => <OnboardingAuthScreen {...props} onLoggedIn={() => setSignedIn(true)} />}
              </GuestStack.Screen>
              <GuestStack.Screen name="OnboardingEmail">
                {(props) => <OnboardingEmailScreen {...props} onLoggedIn={() => setSignedIn(true)} />}
              </GuestStack.Screen>
              <GuestStack.Screen name="Login">
                {(props) => <LoginScreen {...props} onLoggedIn={() => setSignedIn(true)} />}
              </GuestStack.Screen>
            </GuestStack.Navigator>
          ) : (
            <AppStack.Navigator
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#FFFFFF' },
              }}
            >
              <AppStack.Screen name="Main" component={MainTabs} />
              <AppStack.Screen name="ClientDetail" component={ClientDetailScreen} />
              <AppStack.Screen name="ClientForm" component={ClientFormScreen} />
              <AppStack.Screen name="AppointmentForm" component={AppointmentFormScreen} />
              <AppStack.Screen name="InventoryStack" component={InventoryScreen} />
              <AppStack.Screen name="InventoryItem" component={InventoryItemScreen} />
              <AppStack.Screen
                name="FormulaBuilder"
                component={FormulaBuilderScreen}
                options={{ headerShown: false, headerBackButtonMenuEnabled: false }}
              />
              <AppStack.Screen name="VisitDetail" component={VisitDetailScreen} />
              <AppStack.Screen name="Finance" component={FinanceScreen} />
              <AppStack.Screen name="TodaySales" component={TodaySalesScreen} />
              <AppStack.Screen name="Lab" component={LabScreen} />
              <AppStack.Screen name="Profile" component={ProfileScreen} />
              <AppStack.Screen name="Services" component={ServicesScreen} />
              <AppStack.Screen name="Affiliate" component={AffiliateScreen} />
              <AppStack.Screen
                name="Paywall"
                options={{ presentation: 'modal', gestureEnabled: true }}
              >
                {({ navigation: nav }) => (
                  <PaywallScreen
                    onDismiss={({ subscribed }) => {
                      if (subscribed) refreshEntitlement();
                      setShowPaywall(false);
                      nav.goBack();
                    }}
                  />
                )}
              </AppStack.Screen>
              <AppStack.Screen name="PaywallPreview">
                {() => <PaywallScreen onDismiss={() => {}} />}
              </AppStack.Screen>
            </AppStack.Navigator>
          )}
        </NavigationContainer>
      </CurrencyProvider>
    </SafeAreaProvider>
  );
}
