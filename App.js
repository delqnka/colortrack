import React from 'react';
import { View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons'; // We need icons for the nav

// Import Screens
import ClientsScreen from './src/screens/ClientsScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import CalendarScreen from './src/screens/CalendarScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarShowLabel: false,
            tabBarStyle: {
              position: 'absolute',
              bottom: 25,
              left: 24,
              right: 24,
              elevation: 0,
              backgroundColor: '#1C1C1E',
              borderRadius: 35,
              height: 70,
              paddingBottom: 0,
              paddingTop: 0,
              borderTopWidth: 0,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.15,
              shadowRadius: 20,
            },
            tabBarIcon: ({ focused, color, size }) => {
              let iconName;
              if (route.name === 'Dashboard') iconName = focused ? 'home' : 'home-outline';
              else if (route.name === 'Calendar') iconName = focused ? 'file-tray-full' : 'file-tray-full-outline';
              else if (route.name === 'Inventory') iconName = focused ? 'bar-chart' : 'bar-chart-outline';
              else if (route.name === 'Clients') iconName = focused ? 'person' : 'person-outline';

              return (
                <View style={{
                  backgroundColor: focused ? '#fff' : 'transparent',
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}>
                  <Ionicons name={iconName} size={24} color={focused ? '#1C1C1E' : '#FFFFFF'} />
                </View>
              );
            },
          })}
        >
          <Tab.Screen name="Dashboard" component={ClientsScreen} />
          <Tab.Screen name="Calendar" component={CalendarScreen} />
          <Tab.Screen name="Clients" component={ClientsScreen} />
          <Tab.Screen name="Inventory" component={InventoryScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
