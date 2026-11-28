export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      inventory_movements: {
        Row: {
          actor_id: string | null
          created_at: string
          delta_qty: number
          id: string
          inventory_id: string
          medicine_id: string | null
          movement_type: string
          new_qty: number
          previous_qty: number
          reason: string | null
          reservation_id: string | null
          shop_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          delta_qty: number
          id?: string
          inventory_id: string
          medicine_id?: string | null
          movement_type: string
          new_qty: number
          previous_qty: number
          reason?: string | null
          reservation_id?: string | null
          shop_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          delta_qty?: number
          id?: string
          inventory_id?: string
          medicine_id?: string | null
          movement_type?: string
          new_qty?: number
          previous_qty?: number
          reason?: string | null
          reservation_id?: string | null
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "shop_inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      medicines: {
        Row: {
          brand_name: string
          composition_display: string
          composition_key: string
          created_at: string | null
          id: string
          is_jan_aushadhi: boolean
          is_nti: boolean
          is_schedule_h: boolean
          manually_verified: boolean
          manufacturer: string | null
          mrp: number
          pack_size: string | null
        }
        Insert: {
          brand_name: string
          composition_display: string
          composition_key: string
          created_at?: string | null
          id?: string
          is_jan_aushadhi?: boolean
          is_nti?: boolean
          is_schedule_h?: boolean
          manually_verified?: boolean
          manufacturer?: string | null
          mrp: number
          pack_size?: string | null
        }
        Update: {
          brand_name?: string
          composition_display?: string
          composition_key?: string
          created_at?: string | null
          id?: string
          is_jan_aushadhi?: boolean
          is_nti?: boolean
          is_schedule_h?: boolean
          manually_verified?: boolean
          manufacturer?: string | null
          mrp?: number
          pack_size?: string | null
        }
        Relationships: []
      }
      ocr_aliases: {
        Row: {
          correction_count: number
          id: string
          matched_medicine_id: string
          raw_text: string
          updated_at: string | null
        }
        Insert: {
          correction_count?: number
          id?: string
          matched_medicine_id: string
          raw_text: string
          updated_at?: string | null
        }
        Update: {
          correction_count?: number
          id?: string
          matched_medicine_id?: string
          raw_text?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ocr_aliases_matched_medicine_id_fkey"
            columns: ["matched_medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_reports: {
        Row: {
          confirmed_by_patient: boolean
          created_at: string | null
          file_url: string
          id: string
          patient_id: string
          report_date: string | null
          report_type: string
          summary: string | null
          trust_label: string
        }
        Insert: {
          confirmed_by_patient?: boolean
          created_at?: string | null
          file_url: string
          id?: string
          patient_id: string
          report_date?: string | null
          report_type: string
          summary?: string | null
          trust_label?: string
        }
        Update: {
          confirmed_by_patient?: boolean
          created_at?: string | null
          file_url?: string
          id?: string
          patient_id?: string
          report_date?: string | null
          report_type?: string
          summary?: string | null
          trust_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_reports_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pharmacist_notifications: {
        Row: {
          body: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          is_read: boolean
          read_at: string | null
          recipient_user_id: string | null
          shop_id: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          is_read?: boolean
          read_at?: string | null
          recipient_user_id?: string | null
          shop_id: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          is_read?: boolean
          read_at?: string | null
          recipient_user_id?: string | null
          shop_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "pharmacist_notifications_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      pharmacist_verification_notes: {
        Row: {
          author_id: string | null
          created_at: string
          decision_snapshot: string
          id: string
          note: string
          prescription_id: string
          shop_id: string
          verification_id: string
        }
        Insert: {
          author_id?: string | null
          created_at?: string
          decision_snapshot: string
          id?: string
          note: string
          prescription_id: string
          shop_id: string
          verification_id: string
        }
        Update: {
          author_id?: string | null
          created_at?: string
          decision_snapshot?: string
          id?: string
          note?: string
          prescription_id?: string
          shop_id?: string
          verification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pharmacist_verification_notes_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacist_verification_notes_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacist_verification_notes_verification_id_fkey"
            columns: ["verification_id"]
            isOneToOne: false
            referencedRelation: "prescription_verifications"
            referencedColumns: ["id"]
          },
        ]
      }
      pharmacy_demand_responses: {
        Row: {
          availability_status: string
          available_qty: number
          created_at: string
          id: string
          note: string | null
          quoted_unit_price: number | null
          request_id: string
          responded_by: string | null
          shop_id: string
          updated_at: string
        }
        Insert: {
          availability_status: string
          available_qty?: number
          created_at?: string
          id?: string
          note?: string | null
          quoted_unit_price?: number | null
          request_id: string
          responded_by?: string | null
          shop_id: string
          updated_at?: string
        }
        Update: {
          availability_status?: string
          available_qty?: number
          created_at?: string
          id?: string
          note?: string | null
          quoted_unit_price?: number | null
          request_id?: string
          responded_by?: string | null
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_demand_responses_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_medicine_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacy_demand_responses_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      pharmacy_medicine_requests: {
        Row: {
          active_ingredients: string | null
          created_at: string
          dosage_form: string | null
          id: string
          latitude: number | null
          longitude: number | null
          medicine_id: string | null
          medicine_name: string
          patient_id: string | null
          requested_qty: number
          service_area: string | null
          status: string
          strength: string | null
          target_shop_id: string | null
          updated_at: string
        }
        Insert: {
          active_ingredients?: string | null
          created_at?: string
          dosage_form?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          medicine_id?: string | null
          medicine_name: string
          patient_id?: string | null
          requested_qty?: number
          service_area?: string | null
          status?: string
          strength?: string | null
          target_shop_id?: string | null
          updated_at?: string
        }
        Update: {
          active_ingredients?: string | null
          created_at?: string
          dosage_form?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          medicine_id?: string | null
          medicine_name?: string
          patient_id?: string | null
          requested_qty?: number
          service_area?: string | null
          status?: string
          strength?: string | null
          target_shop_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_medicine_requests_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacy_medicine_requests_target_shop_id_fkey"
            columns: ["target_shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      pharmacy_members: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          member_role: string
          shop_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          member_role: string
          shop_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          member_role?: string
          shop_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_members_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      prescription_verifications: {
        Row: {
          created_at: string
          decision_reason: string | null
          id: string
          item_decisions: Json
          prescription_id: string
          reservation_id: string | null
          shop_id: string
          status: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          decision_reason?: string | null
          id?: string
          item_decisions?: Json
          prescription_id: string
          reservation_id?: string | null
          shop_id: string
          status?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          decision_reason?: string | null
          id?: string
          item_decisions?: Json
          prescription_id?: string
          reservation_id?: string | null
          shop_id?: string
          status?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prescription_verifications_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_verifications_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_verifications_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          confirmed_by_patient: boolean
          created_at: string | null
          extracted_items: Json
          id: string
          image_hash: string | null
          image_url: string
          patient_id: string
          trust_checks: Json
        }
        Insert: {
          confirmed_by_patient?: boolean
          created_at?: string | null
          extracted_items?: Json
          id?: string
          image_hash?: string | null
          image_url: string
          patient_id: string
          trust_checks?: Json
        }
        Update: {
          confirmed_by_patient?: boolean
          created_at?: string | null
          extracted_items?: Json
          id?: string
          image_hash?: string | null
          image_url?: string
          patient_id?: string
          trust_checks?: Json
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          allergies: string[] | null
          assigned_shop_id: string | null
          blood_group: string | null
          chronic_conditions: string[] | null
          created_at: string | null
          current_meds: string[] | null
          full_name: string
          id: string
          role: string
          trust_label: string
        }
        Insert: {
          allergies?: string[] | null
          assigned_shop_id?: string | null
          blood_group?: string | null
          chronic_conditions?: string[] | null
          created_at?: string | null
          current_meds?: string[] | null
          full_name: string
          id: string
          role?: string
          trust_label?: string
        }
        Update: {
          allergies?: string[] | null
          assigned_shop_id?: string | null
          blood_group?: string | null
          chronic_conditions?: string[] | null
          created_at?: string | null
          current_meds?: string[] | null
          full_name?: string
          id?: string
          role?: string
          trust_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_assigned_shop_id_fkey"
            columns: ["assigned_shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_items: {
        Row: {
          allow_alternative: boolean
          approved_qty: number
          final_price: number | null
          id: string
          inventory_id: string | null
          item_note: string | null
          item_status: string
          requested_medicine_id: string
          requested_qty: number
          reservation_id: string
          stock_deducted: boolean
          stock_reserved_qty: number
          suggested_medicine_id: string | null
          updated_at: string | null
        }
        Insert: {
          allow_alternative?: boolean
          approved_qty?: number
          final_price?: number | null
          id?: string
          inventory_id?: string | null
          item_note?: string | null
          item_status?: string
          requested_medicine_id: string
          requested_qty?: number
          reservation_id: string
          stock_deducted?: boolean
          stock_reserved_qty?: number
          suggested_medicine_id?: string | null
          updated_at?: string | null
        }
        Update: {
          allow_alternative?: boolean
          approved_qty?: number
          final_price?: number | null
          id?: string
          inventory_id?: string | null
          item_note?: string | null
          item_status?: string
          requested_medicine_id?: string
          requested_qty?: number
          reservation_id?: string
          stock_deducted?: boolean
          stock_reserved_qty?: number
          suggested_medicine_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_items_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "shop_inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_items_requested_medicine_id_fkey"
            columns: ["requested_medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_items_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_items_suggested_medicine_id_fkey"
            columns: ["suggested_medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_status_history: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          created_at: string
          from_status: string | null
          id: string
          reason: string | null
          reservation_id: string
          shop_id: string
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          reservation_id: string
          shop_id: string
          to_status: string
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          reservation_id?: string
          shop_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_status_history_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_status_history_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          created_at: string | null
          estimated_total: number
          expires_at: string | null
          fulfilment_status: string
          id: string
          order_status: string
          patient_id: string
          pharmacist_note: string | null
          plan_mode: string
          prescription_id: string | null
          shop_id: string
          status_reason: string | null
          updated_at: string
          verification_status: string
        }
        Insert: {
          created_at?: string | null
          estimated_total?: number
          expires_at?: string | null
          fulfilment_status?: string
          id?: string
          order_status?: string
          patient_id: string
          pharmacist_note?: string | null
          plan_mode: string
          prescription_id?: string | null
          shop_id: string
          status_reason?: string | null
          updated_at?: string
          verification_status?: string
        }
        Update: {
          created_at?: string | null
          estimated_total?: number
          expires_at?: string | null
          fulfilment_status?: string
          id?: string
          order_status?: string
          patient_id?: string
          pharmacist_note?: string | null
          plan_mode?: string
          prescription_id?: string | null
          shop_id?: string
          status_reason?: string | null
          updated_at?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      share_tokens: {
        Row: {
          created_at: string | null
          expires_at: string
          patient_id: string
          scope: string
          token: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          patient_id: string
          scope: string
          token?: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          patient_id?: string
          scope?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_tokens_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_inventory: {
        Row: {
          archived_at: string | null
          batch_number: string | null
          custom_brand_name: string | null
          custom_composition: string | null
          custom_dosage_form: string | null
          custom_generic_name: string | null
          custom_manufacturer: string | null
          custom_pack_size: string | null
          custom_strength: string | null
          discount_pct: number
          expiry_date: string | null
          id: string
          in_stock: boolean
          is_archived: boolean
          is_available: boolean
          is_catalog_linked: boolean
          is_rx_required: boolean
          medicine_id: string | null
          min_stock_threshold: number
          mrp: number | null
          quantity_on_hand: number
          quantity_reserved: number
          selling_price: number | null
          shop_id: string
          stock_source: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          batch_number?: string | null
          custom_brand_name?: string | null
          custom_composition?: string | null
          custom_dosage_form?: string | null
          custom_generic_name?: string | null
          custom_manufacturer?: string | null
          custom_pack_size?: string | null
          custom_strength?: string | null
          discount_pct?: number
          expiry_date?: string | null
          id?: string
          in_stock?: boolean
          is_archived?: boolean
          is_available?: boolean
          is_catalog_linked?: boolean
          is_rx_required?: boolean
          medicine_id?: string | null
          min_stock_threshold?: number
          mrp?: number | null
          quantity_on_hand?: number
          quantity_reserved?: number
          selling_price?: number | null
          shop_id: string
          stock_source?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          batch_number?: string | null
          custom_brand_name?: string | null
          custom_composition?: string | null
          custom_dosage_form?: string | null
          custom_generic_name?: string | null
          custom_manufacturer?: string | null
          custom_pack_size?: string | null
          custom_strength?: string | null
          discount_pct?: number
          expiry_date?: string | null
          id?: string
          in_stock?: boolean
          is_archived?: boolean
          is_available?: boolean
          is_catalog_linked?: boolean
          is_rx_required?: boolean
          medicine_id?: string | null
          min_stock_threshold?: number
          mrp?: number | null
          quantity_on_hand?: number
          quantity_reserved?: number
          selling_price?: number | null
          shop_id?: string
          stock_source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_inventory_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_inventory_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          address: string
          archetype: string
          confirmed_requests: number
          contact_email: string | null
          contact_phone: string | null
          created_at: string | null
          default_discount_pct: number
          id: string
          lat: number
          license_number: string | null
          lng: number
          name: string
          operating_hours: Json | null
          owner_id: string | null
          pharmacist_reg_number: string | null
          reliability_score: number
          service_radius_km: number | null
          shop_type: string
          total_requests: number
          updated_at: string
          verification_note: string | null
          verification_status: string
        }
        Insert: {
          address: string
          archetype: string
          confirmed_requests?: number
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          default_discount_pct?: number
          id?: string
          lat: number
          license_number?: string | null
          lng: number
          name: string
          operating_hours?: Json | null
          owner_id?: string | null
          pharmacist_reg_number?: string | null
          reliability_score?: number
          service_radius_km?: number | null
          shop_type: string
          total_requests?: number
          updated_at?: string
          verification_note?: string | null
          verification_status?: string
        }
        Update: {
          address?: string
          archetype?: string
          confirmed_requests?: number
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          default_discount_pct?: number
          id?: string
          lat?: number
          license_number?: string | null
          lng?: number
          name?: string
          operating_hours?: Json | null
          owner_id?: string | null
          pharmacist_reg_number?: string | null
          reliability_score?: number
          service_radius_km?: number | null
          shop_type?: string
          total_requests?: number
          updated_at?: string
          verification_note?: string | null
          verification_status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_shop_inventory: {
        Args: {
          p_delta: number
          p_inventory_id: string
          p_movement_type: string
          p_reason?: string | null
          p_reservation_id?: string | null
        }
        Returns: Database["public"]["Tables"]["shop_inventory"]["Row"]
      }
      fulfill_reservation_stock: {
        Args: { p_reservation_id: string }
        Returns: Json
      }
      get_my_shop_id: { Args: never; Returns: string }
      is_shop_member: {
        Args: { p_roles?: string[]; p_shop_id: string }
        Returns: boolean
      }
      release_reservation_stock: {
        Args: { p_reason?: string | null; p_reservation_id: string }
        Returns: Json
      }
      reserve_reservation_stock: {
        Args: { p_item_approvals?: Json | null; p_reservation_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
