import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ClientsScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.userInfo}>
            <Image 
              source={{ uri: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=150&auto=format&fit=crop' }} 
              style={styles.avatar} 
            />
            <View>
              <Text style={styles.greeting}>Hello, Sandra</Text>
              <Text style={styles.date}>Today 25 Nov.</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.searchButton}>
            <Ionicons name="search" size={20} color="#1C1C1E" />
          </TouchableOpacity>
        </View>

        {/* Purple Banner */}
        <View style={styles.bannerContainer}>
          <View style={styles.bannerTextContainer}>
            <Text style={styles.bannerTitle}>Today's Schedule</Text>
            <Text style={styles.bannerSubtitle}>Check your upcoming clients</Text>
            <View style={styles.avatarGroup}>
              <Image source={{ uri: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=100&auto=format&fit=crop' }} style={[styles.miniAvatar, { zIndex: 3 }]} />
              <Image source={{ uri: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=100&auto=format&fit=crop' }} style={[styles.miniAvatar, { marginLeft: -10, zIndex: 2 }]} />
              <Image source={{ uri: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?q=80&w=100&auto=format&fit=crop' }} style={[styles.miniAvatar, { marginLeft: -10, zIndex: 1 }]} />
              <View style={[styles.miniAvatarPlaceholder, { marginLeft: -10, zIndex: 0 }]}>
                <Text style={styles.miniAvatarText}>+4</Text>
              </View>
            </View>
          </View>
          {/* Abstract Shape Placeholder */}
          <View style={styles.abstractShape} />
        </View>

        {/* Date Strip */}
        <View style={styles.dateStrip}>
          {['Sun\n22', 'Mon\n23', 'Tue\n24', 'Wed\n25', 'Thu\n26', 'Fri\n27'].map((day, i) => {
            const isToday = i === 3;
            return (
              <View key={i} style={[styles.dateBox, isToday && styles.dateBoxActive]}>
                <Text style={[styles.dateTextDay, isToday && styles.dateTextActive]}>{day.split('\n')[0]}</Text>
                <Text style={[styles.dateTextNum, isToday && styles.dateTextActive]}>{day.split('\n')[1]}</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Your plan</Text>

        {/* Grid Cards */}
        <View style={styles.gridContainer}>
          <TouchableOpacity style={[styles.card, styles.cardOrange]}>
            <View style={styles.badgeOrange}><Text style={styles.badgeTextOrange}>Upcoming</Text></View>
            <Text style={styles.cardTitle}>Balayage</Text>
            <Text style={styles.cardSubtitle}>25 Nov.</Text>
            <Text style={styles.cardSubtitle}>14:00 - 16:30</Text>
            <Text style={styles.cardSubtitle}>Chair 1</Text>
            
            <View style={styles.cardFooter}>
              <Image source={{ uri: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=100&auto=format&fit=crop' }} style={styles.cardFooterAvatar} />
              <View>
                <Text style={styles.cardFooterTitle}>Client</Text>
                <Text style={styles.cardFooterSubtitle}>Jennifer S.</Text>
              </View>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.card, styles.cardBlue]}>
            <View style={styles.badgeBlue}><Text style={styles.badgeTextBlue}>Alert</Text></View>
            <Text style={styles.cardTitle}>Low Stock</Text>
            <Text style={styles.cardSubtitle}>28 Nov.</Text>
            <Text style={styles.cardSubtitle}>Order needed</Text>
            <Text style={styles.cardSubtitle}>Wella Koleston</Text>
            
            <View style={styles.iconsRow}>
               <View style={styles.iconCircle}><Ionicons name="cube" size={16} color="#fff" /></View>
               <View style={styles.iconCircle}><Ionicons name="cart" size={16} color="#fff" /></View>
            </View>
          </TouchableOpacity>
        </View>
        
        {/* Padding for Bottom Nav */}
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F5FA', // Matches the Dribbble background exactly
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 30,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 16,
  },
  greeting: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1C1C1E',
  },
  date: {
    fontSize: 14,
    color: '#8E8E93',
    fontWeight: '500',
    marginTop: 2,
  },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  bannerContainer: {
    backgroundColor: '#D1C4E9', // Soft purple gradient-like feel
    borderRadius: 24,
    padding: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  bannerTextContainer: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 4,
  },
  bannerSubtitle: {
    fontSize: 14,
    color: '#4A4A4A',
    fontWeight: '500',
    marginBottom: 16,
  },
  avatarGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  miniAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#D1C4E9',
  },
  miniAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#D1C4E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniAvatarText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1C1C1E',
  },
  abstractShape: {
    width: 80,
    height: 80,
    backgroundColor: '#A38BD8',
    borderRadius: 20,
    transform: [{ rotate: '15deg' }],
  },
  dateStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  dateBox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 45,
    height: 65,
    borderRadius: 20,
    backgroundColor: '#FFF',
  },
  dateBoxActive: {
    backgroundColor: '#1C1C1E',
  },
  dateTextDay: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '600',
    marginBottom: 4,
  },
  dateTextNum: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1C1C1E',
  },
  dateTextActive: {
    color: '#FFF',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 16,
  },
  gridContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  card: {
    width: '48%',
    borderRadius: 24,
    padding: 20,
  },
  cardOrange: {
    backgroundColor: '#FFE0B2',
  },
  cardBlue: {
    backgroundColor: '#BBDEFB',
  },
  badgeOrange: {
    backgroundColor: '#FFB74D',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  badgeTextOrange: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFF',
  },
  badgeBlue: {
    backgroundColor: '#64B5F6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  badgeTextBlue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFF',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#555',
    marginBottom: 2,
    fontWeight: '500',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },
  cardFooterAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
  },
  cardFooterTitle: {
    fontSize: 11,
    color: '#555',
  },
  cardFooterSubtitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1C1C1E',
  },
  iconsRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 8,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#64B5F6',
    justifyContent: 'center',
    alignItems: 'center',
  }
});
