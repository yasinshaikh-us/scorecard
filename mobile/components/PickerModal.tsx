import { FlatList, Modal, Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";

// Minimal single-select picker -- RN has no built-in dropdown/select
// control, so this is it. Used by CategoryRulesPanel (category /
// match-field pickers) and TransactionRow (category edit).
//
// Each option gets its own testID (picker-option-<value>), not just its
// label text: a real Stage 2 run hit an option's label text (a category
// name) simultaneously matching several OTHER on-screen elements too --
// e.g. every already-categorized transaction row's own category badge --
// making a text-based matcher genuinely ambiguous, not just a picker-vs-
// picker collision. A stable per-option id sidesteps that regardless of
// what else happens to be showing the same text elsewhere on screen.
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
  const { colors } = useTheme();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { color: colors.text, fontFamily: fontFamily.semibold }]}>{title}</Text>
          <FlatList
            testID="picker-options-list"
            data={options}
            keyExtractor={(o) => o.value}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => (
              <Pressable
                testID={`picker-option-${item.value}`}
                style={[styles.option, { borderBottomColor: colors.borderSubtle }]}
                onPress={() => {
                  onSelect(item.value);
                  onClose();
                }}
              >
                <Text style={[styles.optionText, { color: colors.text, fontFamily: fontFamily.regular }]}>{item.label}</Text>
              </Pressable>
            )}
          />
          <Pressable testID="picker-cancel-button" style={styles.cancel} onPress={onClose}>
            <Text style={[styles.cancelText, { color: colors.accent, fontFamily: fontFamily.semibold }]}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 32 },
  title: { fontSize: 15, marginBottom: 8, textAlign: "center" },
  option: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  optionText: { fontSize: 15, textAlign: "center" },
  cancel: { marginTop: 12, paddingVertical: 10 },
  cancelText: { textAlign: "center", fontSize: 15 },
});
