import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";

// Minimal single-select picker, standing in for the web's <select> -- RN
// has no built-in equivalent. Used by CategoryRulesPanel (category /
// match-field pickers) and TransactionRow (category edit).
export default function PickerModal({
  visible,
  title,
  options,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: { label: string; value: string }[];
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(o) => o.value}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => (
              <Pressable
                style={styles.option}
                onPress={() => {
                  onSelect(item.value);
                  onClose();
                }}
              >
                <Text style={styles.optionText}>{item.label}</Text>
              </Pressable>
            )}
          />
          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 32 },
  title: { fontSize: 15, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  option: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#eee" },
  optionText: { fontSize: 15, textAlign: "center" },
  cancel: { marginTop: 12, paddingVertical: 10 },
  cancelText: { textAlign: "center", color: "#1a73e8", fontSize: 15, fontWeight: "600" },
});
